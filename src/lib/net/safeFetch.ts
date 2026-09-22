/**
 * Outbound HTTP for Tier A checks, with the host guard applied to every hop.
 *
 * `assertPublicHost` (src/lib/net/hostSafety.ts) is only meaningful for the URL it is handed. A
 * redirect is a second request to a host nobody checked — so a domain that passes validation and
 * resolution can answer `302 Location: http://169.254.169.254/latest/meta-data/` and the server
 * follows it. That reopens exactly the request-forgery path the guard was added to close, and on
 * the Tier A path it reopens it with a read channel: the resolved URL and the response's content
 * are written into the Finding the consultant reads back.
 *
 * So redirects are never followed automatically here. Every hop is resolved and checked before it
 * is fetched, and the chain is bounded.
 *
 * Deliberately Tier-A-shaped: it returns a `null`-ish result rather than throwing on a refused or
 * unreachable host, because an unreachable domain is an ordinary, expected Tier A finding ("the
 * business's site does not respond") and not an error condition.
 */

import { assertPublicHost } from "./hostSafety";

export const TIER_A_USER_AGENT =
  "CloseCheck-TierA-Scanner/0.1 (+https://closecheck.example)";

export type SafeFetchOutcome =
  | { kind: "response"; response: Response; url: string }
  | { kind: "unreachable" }
  /** The host was refused by the guard — distinct from unreachable, and worth surfacing. */
  | { kind: "refused"; reason: string };

/** One request, with the host checked first and redirects never followed automatically. */
export async function safeFetch(url: string, timeoutMs: number): Promise<SafeFetchOutcome> {
  let hostname: string;
  try {
    const parsed = new URL(url);
    // Only http(s). A `file:`, `gopher:` or similar Location would otherwise be handed to fetch.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { kind: "refused", reason: `refuses to follow a ${parsed.protocol} URL` };
    }
    hostname = parsed.hostname;
  } catch {
    return { kind: "refused", reason: "is not a valid URL" };
  }

  const verdict = await assertPublicHost(hostname);
  if (!verdict.safe) {
    return { kind: "refused", reason: verdict.reason };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": TIER_A_USER_AGENT },
    });
    return { kind: "response", response, url };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

export type RedirectHop = { url: string; status: number };

export type FollowResult = {
  /** The final response, if the chain ended at one. */
  response: Response | null;
  /** The URL the final response came from. */
  finalUrl: string | null;
  /** Each redirect target observed, in order. */
  chain: RedirectHop[];
  /** Whether the first request got any answer at all. */
  reachable: boolean;
  /** Set when a hop was refused by the host guard, naming why. */
  refused: string | null;
};

/**
 * Follow a redirect chain manually, checking each hop's host before fetching it.
 *
 * `stopAt` lets a caller end the walk early — the HTTPS-hygiene check stops as soon as the chain
 * reaches an https:// URL, because at that point it has the answer it wanted and has no reason to
 * make a further request.
 */
export async function followSafely(
  startUrl: string,
  options: { timeoutMs: number; maxHops: number; stopAt?: (url: string) => boolean },
): Promise<FollowResult> {
  const chain: RedirectHop[] = [];
  let url = startUrl;
  let reachable = false;

  for (let hop = 0; hop <= options.maxHops; hop += 1) {
    const outcome = await safeFetch(url, options.timeoutMs);

    if (outcome.kind === "refused") {
      // A refusal on the FIRST request means the domain itself is disallowed; on a later hop it
      // means the site redirected somewhere it shouldn't. Both are reported, neither is followed.
      return { response: null, finalUrl: null, chain, reachable, refused: outcome.reason };
    }
    if (outcome.kind === "unreachable") {
      return { response: null, finalUrl: null, chain, reachable, refused: null };
    }

    reachable = true;
    const { response } = outcome;
    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && location;

    if (!isRedirect) {
      return { response, finalUrl: url, chain, reachable, refused: null };
    }

    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      // A malformed Location ends the chain rather than failing the check — the response we
      // already have is still a valid observation.
      return { response, finalUrl: url, chain, reachable, refused: null };
    }

    chain.push({ url: next, status: response.status });
    if (options.stopAt?.(next)) {
      return { response, finalUrl: url, chain, reachable, refused: null };
    }
    url = next;
  }

  // Hop limit reached. Not an error: a redirect loop is itself an observation.
  return { response: null, finalUrl: null, chain, reachable, refused: null };
}
