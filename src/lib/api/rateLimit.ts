import { NextResponse } from "next/server";

/**
 * Rate limiting for the public read-only API (docs/spec.md §13.2).
 *
 * The API accepts a bearer token from anywhere on the internet and, before this, had no limit of any
 * kind: a single key could drive unbounded concurrent queries against the same Postgres the
 * interactive app depends on, so one firm's runaway integration script was a denial of service
 * against every other tenant. That is a tenant-isolation-adjacent failure in the availability
 * direction, which §8's reputational-risk framing weights heavily.
 *
 * **In-process, per-instance, deliberately.** The app runs as a long-lived Node server
 * (docs/deployment.md explains why it is not serverless), so a plain Map survives between requests
 * and costs nothing. The honest limitation: with more than one instance, each enforces its own
 * budget, so the effective limit is (limit x instances). That is acceptable while this runs as a
 * single container and must be replaced with a shared store (Redis, or Postgres if a round trip per
 * request is acceptable) before horizontal scaling — not after. There is exactly one deployment
 * today and it is not yet deployed, so building the distributed version now would be speculative
 * infrastructure for a scale that does not exist; building nothing was the actual mistake.
 *
 * Fixed window rather than a sliding log: a burst straddling a window boundary can briefly reach
 * twice the limit, which is fine for a budget whose purpose is preventing runaway clients rather
 * than precise fairness, and it costs one integer per key instead of a timestamp list.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Requests per window, per key. Env-tunable so a real integration that legitimately needs more
 * does not require a deploy to unblock. */
function limitPerWindow(): number {
  const parsed = Number.parseInt(process.env.API_RATE_LIMIT_PER_MINUTE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

const WINDOW_MS = 60_000;

/**
 * Bounds the map so a flood of distinct unauthenticated sources cannot turn the limiter itself into
 * the memory exhaustion it exists to prevent. Pruning on write is enough — entries are only ever
 * created by a request, so there is no way to accumulate without one.
 */
const MAX_TRACKED_KEYS = 10_000;

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  // Still over budget after dropping expired entries: this is an active flood of distinct keys, so
  // drop oldest-resetting first. Insertion order is close enough to that for a fixed window.
  const excess = buckets.size - MAX_TRACKED_KEYS;
  let dropped = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++dropped >= excess) break;
  }
}

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  const limit = limitPerWindow();
  prune(now);

  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + WINDOW_MS };
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

/** Test seam only — the module-level Map would otherwise carry state between test cases. */
export function resetRateLimitState(): void {
  buckets.clear();
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
 * The bucket key. Authenticated requests are budgeted per API key, so one firm's noisy integration
 * cannot spend another firm's allowance — the same per-tenant reasoning the rest of the API follows.
 *
 * Unauthenticated requests are budgeted per client address, which is weaker (an address is
 * spoofable-ish behind proxies and shared by NAT) but is the only identity available before a token
 * has been validated. It exists to stop an unauthenticated flood from reaching the database at all,
 * not to be an authorization mechanism. Falls back to a single shared bucket when no address can be
 * determined: degrading to one global budget for anonymous traffic is the safe direction.
 */
export function rateLimitKeyForRequest(request: Request, apiKeyId?: string): string {
  if (apiKeyId) return `key:${apiKeyId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
  return address ? `ip:${address}` : "ip:unknown";
}
