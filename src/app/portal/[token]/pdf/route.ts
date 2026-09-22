import { NextResponse } from "next/server";
import { fileResponseHeaders } from "@/lib/http/fileResponseHeaders";
import { headers } from "next/headers";
import { getObject } from "@/lib/storage/objectStore";
import { resolvePortalAccess } from "../access";
import { portalRequestAllowed } from "@/lib/portal/rateLimit";

/**
 * Serves the shared Report PDF to a buyer holding a live magic link (spec.md §7).
 *
 * Replaces base64-inlining the whole PDF into the portal page's server-rendered HTML, which
 * inflated it ~33%, sent it on every page load with no browser caching or range requests, and —
 * increasingly — simply did not render: browsers restrict plugin-rendered `data:` PDFs in frames,
 * which made the buyer-facing surface effectively broken on mobile Safari.
 *
 * Authorization is unchanged and deliberately identical to the page's: resolvePortalAccess →
 * withPortalScope → the portal role's RLS policies. The token in the URL is the only credential,
 * and a token that is unknown, revoked or expired resolves to nothing at the database layer. There
 * is no reportId, orgId or storage key in this route's inputs.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const requestHeaders = await headers();

  // Before resolving anything, and deliberately before writing an access-log row: this route
  // serves a multi-hundred-kilobyte document and writes a row on every call, and nothing bounded
  // either. A refused request is not logged, which is the point — the rows are the resource being
  // protected — and the requests that got through are still in the trail, so heavy access remains
  // visible rather than being erased by exceeding the limit.
  const verdict = portalRequestAllowed(requestHeaders, token);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Too many requests for this link. Retry shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(verdict.retryAfterSeconds),
          "Cache-Control": "private, no-store",
        },
      },
    );
  }

  // Every fetch of the report bytes is logged, including the one the page's own embedded viewer
  // makes. This used to skip logging when `Sec-Fetch-Dest: iframe` was present, so as not to
  // double-count that viewer — but that header is forbidden to browser scripts and entirely free
  // for anything else, so a client that sent it erased itself from the access trail. Ten complete
  // downloads, and the consultant's audit page read "never viewed".
  //
  // The page-and-its-own-viewer pair is collapsed when the trail is summarised instead. Getting
  // that wrong costs a display artefact; getting this wrong cost the evidence.
  const access = await resolvePortalAccess(token, {
    log: true,
    kind: "DOCUMENT",
    headers: requestHeaders,
  });

  // Same deliberate non-distinction the page makes: unknown, revoked and expired all look alike
  // from outside, so a revoked link cannot be used to confirm a report ever existed.
  if (!access || !access.pdfStorageKey) {
    return NextResponse.json({ error: "Report not available" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    // access.orgId comes from the resolved link, never from the request — and the link and its
    // report are now checked to name the same org before this point. The key must belong to that
    // org too: a report row carrying another firm's key would otherwise hand a buyer the wrong
    // firm's document, which is the same disclosure one layer further out.
    bytes = await getObject(access.orgId, access.pdfStorageKey);
  } catch {
    // The row points at a file that is not there (database restored onto a fresh volume, file
    // removed by hand). A clean 404 the page can degrade against, not a 500.
    return NextResponse.json({ error: "Report not available" }, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Length": String(bytes.length),
      ...fileResponseHeaders({
        contentType: "application/pdf",
        // Inline is the buyer's viewer. No content-security policy for that reason: `sandbox` is
        // exactly what would leave them looking at a blank frame.
        disposition: download ? "attachment" : "inline",
        // Deliberately generic: the portal role cannot read the engagement, and a filename is one
        // more place a target business's name could leak into a downloads folder or a mail client.
        filename: "due-diligence-report.pdf",
        // A token-scoped, revocable document must never be held by a shared cache: revocation has
        // to take effect immediately (spec.md §7), and a CDN copy would outlive it.
        cacheExtra: "must-revalidate",
      }),
      // Stricter than the shared default: this one is reachable without a session, so it gets
      // noarchive as well.
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
