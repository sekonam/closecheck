import { followSafely, safeFetch } from "@/lib/net/safeFetch";

export interface HttpsHygiene {
  /** Whether http://<domain> answered at all (any status, including redirects). */
  httpReachable: boolean;
  /** Whether the redirect chain starting at http://<domain> reaches an https:// URL (followed up to
   * MAX_REDIRECT_HOPS — e.g. http://x → http://www.x → https://www.x still counts). */
  httpRedirectsToHttps: boolean;
  /** Each Location observed while following the HTTP redirect chain, in order; empty when the first
   * HTTP response was not a redirect. */
  httpRedirectChain: string[];
  httpsReachable: boolean;
  /** Raw Strict-Transport-Security header from the HTTPS response, null when absent. */
  hstsHeader: string | null;
  error: string | null;
}

/**
 * Observes HTTP→HTTPS redirect behavior and the HSTS header from a single unauthenticated request to
 * each scheme (spec.md §4, §13.1: Tier A, automated, observation only — the runner in
 * src/lib/audit/tierA.ts turns these observations into a severity, not this module).
 */
const MAX_REDIRECT_HOPS = 3;

/**
 * Follows the redirect chain from http://<domain> while it stays on http://, up to
 * MAX_REDIRECT_HOPS — many sites hop http://x → http://www.x → https://www.x, and judging only the
 * first hop would mislabel them as not reaching HTTPS.
 *
 * Every hop's host is resolved and checked before it is fetched (src/lib/net/safeFetch.ts). A
 * redirect is a request to a host nobody validated, so following one automatically would let a
 * domain that passed validation hand the server an internal address — and this check writes the
 * resolved chain into the Finding, so that would carry a read channel with it.
 */
async function followHttpChain(
  domain: string,
  timeoutMs: number,
): Promise<{ reachable: boolean; reachesHttps: boolean; chain: string[]; refused: string | null }> {
  const result = await followSafely(`http://${domain}`, {
    timeoutMs,
    maxHops: MAX_REDIRECT_HOPS,
    // Stop as soon as the chain reaches HTTPS: that is the answer this check wants, and there is
    // no reason to make a further request once we have it.
    stopAt: (url) => /^https:\/\//i.test(url),
  });

  const chain = result.chain.map((hop) => hop.url);
  const reachesHttps = chain.length > 0 && /^https:\/\//i.test(chain[chain.length - 1]);
  return { reachable: result.reachable, reachesHttps, chain, refused: result.refused };
}

export async function checkHttpsHygiene(domain: string, timeoutMs = 8000): Promise<HttpsHygiene> {
  const [http, httpsOutcome] = await Promise.all([
    followHttpChain(domain, timeoutMs),
    safeFetch(`https://${domain}`, timeoutMs),
  ]);

  const httpsRes = httpsOutcome.kind === "response" ? httpsOutcome.response : null;
  // A refused host is not the same as an unreachable one, and saying so keeps the finding honest:
  // "we declined to fetch this" must never read as "the site does not respond".
  const refused =
    http.refused ?? (httpsOutcome.kind === "refused" ? httpsOutcome.reason : null);

  return {
    httpReachable: http.reachable,
    httpRedirectsToHttps: http.reachesHttps,
    httpRedirectChain: http.chain,
    httpsReachable: httpsRes !== null,
    hstsHeader: httpsRes?.headers.get("strict-transport-security") ?? null,
    error: refused
      ? `Not checked: ${refused}`
      : !http.reachable && httpsRes === null
        ? "Neither http:// nor https:// responded"
        : null,
  };
}
