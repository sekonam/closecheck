/**
 * Response headers for serving a stored file, in one place instead of four.
 *
 * WHY THIS IS CENTRALISED
 * -----------------------
 * Four routes hand bytes back to a browser — evidence downloads, the consultant's report PDF, the
 * buyer's portal PDF, and the firm's logo — and each had built its own header set. Three of them
 * had converged on the same protections. The logo route had none of them: no `nosniff`, no
 * `X-Robots-Tag`, no content-security policy, and a `Cache-Control` missing `private`. Nothing
 * had gone wrong yet, and nothing signalled the difference either, because each route's headers
 * looked deliberate in isolation.
 *
 * That is the same shape as the logo content-type map (src/lib/branding/logoContentType.ts), which
 * existed in three copies each commented as "the security boundary" and had already drifted. A
 * boundary implemented N times is one boundary and N-1 chances to forget, and the one that forgets
 * is the one nobody re-reads. So the invariants live here and cannot be passed in:
 *
 * - **`X-Content-Type-Options: nosniff`** — removes "the browser decides it knows better than the
 *   Content-Type" entirely. Near-moot beside an attachment disposition, but it is one header and it
 *   means the protection stops depending on the disposition being right.
 * - **`Cache-Control: private, ...`** — everything served through here is tenant-scoped or
 *   token-scoped. A shared cache holding any of it outlives the access control that released it,
 *   and for a revocable portal link that directly contradicts spec.md §7.
 * - **`X-Robots-Tag: noindex, nofollow`** — none of this should ever reach a search index.
 *
 * What legitimately varies is passed in: the content type, whether the browser should render it or
 * save it, and whether a content-security policy applies.
 */

export type FileResponseOptions = {
  contentType: string;
  /** `inline` only where the browser is meant to render it — the portal's PDF viewer, an <img> src. */
  disposition: "attachment" | "inline";
  /** Omitted entirely when absent, which is right where a filename would itself leak something. */
  filename?: string;
  /**
   * RFC 5987 encoded form, for a filename with non-ASCII characters. Supplied only by the evidence
   * route, which serves seller-supplied names.
   */
  filenameEncoded?: string;
  /**
   * A content-security policy, when one applies.
   *
   * NOT defaulted on. `default-src 'none'; sandbox` is right for content this product did not
   * author and never intends to render — and `sandbox` is exactly what would break a PDF the
   * portal deliberately renders inline in the buyer's browser. A default that has to be switched
   * off for the two routes serving the product's primary deliverable is not a default.
   */
  csp?: string;
  /** Extra cache directives after `private, no-store` — e.g. `must-revalidate` for a revocable link. */
  cacheExtra?: string;
};

export function fileResponseHeaders(options: FileResponseOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": options.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": `private, no-store${options.cacheExtra ? `, ${options.cacheExtra}` : ""}`,
    "X-Robots-Tag": "noindex, nofollow",
  };

  if (options.filename) {
    const encoded = options.filenameEncoded
      ? `; filename*=UTF-8''${options.filenameEncoded}`
      : "";
    headers["Content-Disposition"] = `${options.disposition}; filename="${options.filename}"${encoded}`;
  } else {
    headers["Content-Disposition"] = options.disposition;
  }

  if (options.csp) headers["Content-Security-Policy"] = options.csp;

  return headers;
}

/** The policy for content this product neither authored nor can vouch for. With no sources
 * permitted, a document that somehow did get rendered still cannot load or execute anything. */
export const UNTRUSTED_CONTENT_CSP = "default-src 'none'; sandbox";
