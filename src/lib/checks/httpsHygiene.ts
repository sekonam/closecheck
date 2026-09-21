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

const FETCH_HEADERS = { "User-Agent": "CloseCheck-TierA-Scanner/0.1 (+https://closecheck.example)" };

async function fetchManual(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "manual", headers: FETCH_HEADERS });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Observes HTTP→HTTPS redirect behavior and the HSTS header from a single unauthenticated request to
 * each scheme (spec.md §4, §13.1: Tier A, automated, observation only — the runner in
 * src/lib/audit/tierA.ts turns these observations into a severity, not this module).
 */
const MAX_REDIRECT_HOPS = 3;

/** Follows the redirect chain from http://<domain> while it stays on http://, up to
 * MAX_REDIRECT_HOPS — many sites hop http://x → http://www.x → https://www.x, and judging only the
 * first hop would mislabel them as not reaching HTTPS. */
async function followHttpChain(
  domain: string,
  timeoutMs: number,
): Promise<{ reachable: boolean; reachesHttps: boolean; chain: string[] }> {
  let url = `http://${domain}`;
  const chain: string[] = [];

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const res = await fetchManual(url, timeoutMs);
    if (res === null) {
      return { reachable: hop > 0, reachesHttps: false, chain };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      return { reachable: true, reachesHttps: false, chain };
    }
    const next = new URL(location, url).toString();
    chain.push(next);
    if (/^https:\/\//i.test(next)) {
      return { reachable: true, reachesHttps: true, chain };
    }
    url = next;
  }
  return { reachable: true, reachesHttps: false, chain };
}

export async function checkHttpsHygiene(domain: string, timeoutMs = 8000): Promise<HttpsHygiene> {
  const [http, httpsRes] = await Promise.all([
    followHttpChain(domain, timeoutMs),
    fetchManual(`https://${domain}`, timeoutMs),
  ]);

  return {
    httpReachable: http.reachable,
    httpRedirectsToHttps: http.reachesHttps,
    httpRedirectChain: http.chain,
    httpsReachable: httpsRes !== null,
    hstsHeader: httpsRes?.headers.get("strict-transport-security") ?? null,
    error: !http.reachable && httpsRes === null ? "Neither http:// nor https:// responded" : null,
  };
}
