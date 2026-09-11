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
  { name: "WooCommerce", test: (html) => /woocommerce/i.test(html) },
  { name: "Toast (restaurant POS/ordering)", test: (html) => /toasttab\.com/i.test(html) },
  { name: "Clover", test: (html) => /clover\.com/i.test(html) },
];

/**
 * Best-effort CMS/platform fingerprint via a single unauthenticated GET (spec.md §4: Tier A,
 * "automated, best-effort" — a consultant reviews this, it is not asserted as certain). Looks at the
 * generator meta tag and known asset/script URL patterns; does not execute JS, so client-rendered
 * SPA storefronts may under-report.
 */
export async function fingerprintCms(url: string, timeoutMs = 8000): Promise<CmsFingerprint> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CloseCheck-TierA-Scanner/0.1 (+https://closecheck.example)" },
    });
    clearTimeout(timeout);

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
