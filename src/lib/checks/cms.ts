import { followSafely } from "@/lib/net/safeFetch";

export interface CmsFingerprint {
  cms: string | null;
  version: string | null;
  signals: string[];
  error: string | null;
}

const CMS_SIGNATURES: Array<{ name: string; test: (html: string, headers: Headers) => boolean }> = [
  { name: "WordPress", test: (html) => /wp-content|wp-includes/i.test(html) },
  { name: "Shopify", test: (html, h) => /cdn\.shopify\.com/i.test(html) || /shopify/i.test(h.get("x-shardid") ?? "") },
  { name: "Wix", test: (html) => /static\.wixstatic\.com|wix\.com/i.test(html) },
  { name: "Squarespace", test: (html) => /squarespace\.com/i.test(html) },
  { name: "Webflow", test: (html) => /webflow\.com/i.test(html) },
  { name: "Weebly", test: (html) => /weebly\.com/i.test(html) },
  {
    // Not a bare /woocommerce/i: modern WordPress core ships the string "WooCommerceBlocksEnabled"
    // whether or not WooCommerce is installed, so the loose match reported a payment surface on
    // sites that have none — verified against wordpress.org and techcrunch.com, neither of which
    // runs it. Listing every matched signature in the note turned that latent false positive into
    // a printed claim to a buyer, so it needs to be right rather than indicative.
    name: "WooCommerce",
    test: (html) =>
      /wp-content\/plugins\/woocommerce|woocommerce\.min\.(js|css)|class=["'][^"']*woocommerce-page/i.test(
        html,
      ),
  },
  { name: "Toast (restaurant POS/ordering)", test: (html) => /toasttab\.com/i.test(html) },
  { name: "Clover", test: (html) => /clover\.com/i.test(html) },
];

const MAX_REDIRECT_HOPS = 3;

/**
 * Best-effort CMS/platform fingerprint via a single unauthenticated GET (spec.md §4: Tier A,
 * "automated, best-effort" — a consultant reviews this, it is not asserted as certain). Looks at the
 * generator meta tag and known asset/script URL patterns; does not execute JS, so client-rendered
 * SPA storefronts may under-report.
 */
export async function fingerprintCms(url: string, timeoutMs = 8000): Promise<CmsFingerprint> {
  try {
    // Redirects are followed manually with each hop's host resolved and checked first
    // (src/lib/net/safeFetch.ts). undici's default `redirect: "follow"` would fetch whatever a
    // Location header named, unvalidated — and this check reads the response body and puts the
    // generator tag straight into the Finding, so an unchecked hop is a request-forgery path with
    // the response handed back to whoever asked for it.
    const result = await followSafely(url, { timeoutMs, maxHops: MAX_REDIRECT_HOPS });

    if (result.refused) {
      return { cms: null, version: null, signals: [], error: `Not checked: ${result.refused}` };
    }
    const res = result.response;
    if (!res) {
      return {
        cms: null,
        version: null,
        signals: [],
        error: result.reachable ? "Redirect chain did not resolve" : "Fetch failed",
      };
    }

    const html = await res.text();
    const signals: string[] = [];

    const generatorMatch = html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i);
    if (generatorMatch) signals.push(`generator meta tag: ${generatorMatch[1]}`);

    const matched = CMS_SIGNATURES.filter((sig) => sig.test(html, res.headers));
    for (const m of matched) signals.push(`matched signature: ${m.name}`);

    const versionMatch = generatorMatch?.[1]?.match(/[\d.]+/);

    return {
      cms: matched[0]?.name ?? (generatorMatch ? generatorMatch[1] : null),
      version: versionMatch?.[0] ?? null,
      signals,
      error: null,
    };
  } catch (err) {
    return {
      cms: null,
      version: null,
      signals: [],
      error: err instanceof Error ? err.message : "Fetch failed",
    };
  }
}

/** Exposed for tests: the signature list is content, and content nothing verifies drifts. */
export const __cmsSignaturesForTests = CMS_SIGNATURES;
