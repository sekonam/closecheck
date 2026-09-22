import { NextResponse } from "next/server";

/**
 * Fixed-window rate limiting, shared by the public read-only API (docs/spec.md §13.2) and by
 * sign-in (src/lib/auth/rateLimit.ts).
 *
 * The API accepts a bearer token from anywhere on the internet and, before this existed, had no
 * limit of any kind: a single key could drive unbounded concurrent queries against the same
 * Postgres the interactive app depends on, so one firm's runaway integration was a denial of
 * service against every other tenant. That is a tenant-isolation failure in the availability
 * direction, which §8's reputational-risk framing weights heavily.
 *
 * **In-process, per-instance, deliberately.** The app runs as a long-lived Node server
 * (docs/deployment.md explains why it is not serverless), so a plain Map survives between requests
 * and costs nothing. The honest limitation: with more than one instance each enforces its own
 * budget, so the effective limit is (limit x instances). That is acceptable while this runs as a
 * single container and must be replaced with a shared store (Redis, or Postgres if a round trip per
 * request is acceptable) before horizontal scaling — not after.
 *
 * Fixed window rather than a sliding log: a burst straddling a window boundary can briefly reach
 * twice the limit, which is fine for a budget whose purpose is preventing runaway clients rather
 * than precise fairness, and it costs one integer per key instead of a timestamp list.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const DEFAULT_WINDOW_MS = 60_000;

/** Requests per window, per key, for the API. Env-tunable so a real integration that legitimately
 * needs more does not require a deploy to unblock. */
function apiLimitPerWindow(): number {
  const parsed = Number.parseInt(process.env.API_RATE_LIMIT_PER_MINUTE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

/**
 * Bounds the map so a flood of distinct sources cannot turn the limiter itself into the memory
 * exhaustion it exists to prevent.
 */
const MAX_TRACKED_KEYS = 10_000;

/** Full scans are O(n); doing one on every call turned a full map into an amplifier, making every
 * request walk 10,000 entries. Once per second is ample for a minute-wide window. */
const PRUNE_INTERVAL_MS = 1_000;
let lastPruneAt = 0;

function prune(now: number, force: boolean): void {
  if (!force && now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size <= MAX_TRACKED_KEYS) return;

  /**
   * Still over budget after dropping expired entries: an active flood of distinct keys. Evict the
   * entries that expire SOONEST, not the ones inserted earliest.
   *
   * Insertion order was actively dangerous here. Sign-in failure counters are long-lived by design
   * (a 15-minute window against the API's one minute), so they were always the oldest entries in
   * the map and therefore first to be evicted — meaning a flood of short-lived API buckets flushed
   * exactly the budget that is meant to survive an attack. Evicting by soonest-expiry inverts that:
   * the short-lived API buckets go first, which is also the cheapest thing to lose.
   */
  const byExpiry = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (let i = 0; i < byExpiry.length - MAX_TRACKED_KEYS; i++) {
    buckets.delete(byExpiry[i][0]);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  now?: number;
  /** Per-call budget. Sign-in needs a far smaller one than the API — ten password attempts a
   * minute, not a hundred and twenty. */
  limit?: number;
  /** Per-call window. Sign-in's failure counter is 15 minutes wide; the API's is one. */
  windowMs?: number;
};

function resolve(options: RateLimitOptions): { now: number; limit: number; windowMs: number } {
  const now = options.now ?? Date.now();
  const limit =
    Number.isFinite(options.limit) && (options.limit as number) > 0
      ? (options.limit as number)
      : apiLimitPerWindow();
  const windowMs =
    Number.isFinite(options.windowMs) && (options.windowMs as number) > 0
      ? (options.windowMs as number)
      : DEFAULT_WINDOW_MS;
  return { now, limit, windowMs };
}

export function checkRateLimit(key: string, options: RateLimitOptions = {}): RateLimitResult {
  const { now, limit, windowMs } = resolve(options);
  prune(now, false);

  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count++;
  buckets.set(key, bucket);

  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Reads a bucket without spending from it. Sign-in needs this because its budget counts FAILED
 * attempts, not attempts: the decision to refuse has to be made before the password is checked,
 * while the decision to charge for it can only be made afterwards.
 */
export function peekRateLimit(key: string, options: RateLimitOptions = {}): boolean {
  const { now, limit } = resolve(options);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return true;
  return bucket.count < limit;
}

/** Drops a key's budget entirely — used when a sign-in succeeds, so a legitimate user who mistyped
 * their password a few times does not carry those failures forward. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test seam only — the module-level Map would otherwise carry state between test cases. */
export function resetRateLimitState(): void {
  buckets.clear();
  lastPruneAt = 0;
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

export function apiTooManyRequests(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Rate limit exceeded. Slow down and retry after the interval in the Retry-After header." },
    {
      status: 429,
      headers: { ...rateLimitHeaders(result), "Retry-After": String(result.retryAfterSeconds) },
    },
  );
}

/**
 * The client address, read from X-Forwarded-For with an explicit count of trusted proxies.
 *
 * Taking `split(",")[0]` — the LEFTMOST entry — was wrong and load-bearing. Every reverse proxy
 * that appends (nginx's proxy_add_x_forwarded_for, Cloudflare, Fly, Render — two of the three
 * targets docs/deployment.md names) leaves an attacker-supplied value in that position, because the
 * client can simply send its own X-Forwarded-For header and the proxy appends the real address
 * after it. So every address-keyed budget was trivially bypassable by rotating a header, and worse,
 * an attacker could *choose* to be seen as someone else's address — which made the sign-in failure
 * counter aimable at a specific victim, the exact weapon its design was supposed to rule out.
 *
 * With N trusted proxies the client is at `parts[parts.length - N]`: everything to the right was
 * appended by infrastructure we control, everything to the left is hearsay. TRUSTED_PROXY_HOPS
 * defaults to 1 because every supported deployment target sits behind exactly one.
 *
 * Set it to 0 when the app is reachable directly, with no proxy in front. Then X-Forwarded-For is
 * entirely attacker-controlled and is ignored outright — every anonymous caller shares one bucket.
 * That over-restricts strangers, which is the safe direction to be wrong in.
 */
export function clientAddressFrom(request: Request | undefined): string {
  if (!request) return "unknown";

  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  const trusted = Number.isFinite(hops) && hops >= 0 ? hops : 1;
  if (trusted === 0) return "unknown";

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    // Fewer hops present than configured means the header did not pass through the expected
    // infrastructure. Trusting the leftmost value here is what the whole comment above warns
    // against, so refuse to guess and fall back to the shared bucket.
    const candidate = parts.length >= trusted ? parts[parts.length - trusted] : undefined;
    if (candidate) return candidate;
  }

  // x-real-ip is set by the proxy and not appended to, so it is not forgeable the same way — but
  // it is only meaningful if a proxy is actually in front, which `trusted > 0` asserts.
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * The bucket key. Authenticated requests are budgeted per API key, so one firm's noisy integration
 * cannot spend another firm's allowance — the same per-tenant reasoning the rest of the API
 * follows. Unauthenticated ones are budgeted per client address, the only identity available before
 * a token has been validated.
 */
export function rateLimitKeyForRequest(request: Request, apiKeyId?: string): string {
  if (apiKeyId) return `key:${apiKeyId}`;
  return `ip:${clientAddressFrom(request)}`;
}

export function apiRateLimitOptions(): RateLimitOptions {
  return { limit: apiLimitPerWindow(), windowMs: DEFAULT_WINDOW_MS };
}
