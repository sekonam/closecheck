import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getObject } from "@/lib/storage/local";
import { resolvePortalAccess } from "../access";

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

  // The page render already wrote an access-log row for this visit, and the viewer it renders then
  // fetches this URL as a subresource — logging that fetch too would double every visit in the
  // access trail spec.md §8 promises. Anything that is NOT that embedded fetch (a direct
  // navigation, a forwarded link, a download) is a real, separate access and is logged. Missing
  // header (curl, an old browser) counts as a real access: over-logging an access trail is the safe
  // direction to fail.
  const embeddedInOwnPage = requestHeaders.get("sec-fetch-dest") === "iframe";

  const access = await resolvePortalAccess(token, {
    log: !embeddedInOwnPage,
    forwardedFor: requestHeaders.get("x-forwarded-for"),
  });

  // Same deliberate non-distinction the page makes: unknown, revoked and expired all look alike
  // from outside, so a revoked link cannot be used to confirm a report ever existed.
  if (!access || !access.pdfStorageKey) {
    return NextResponse.json({ error: "Report not available" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await getObject(access.pdfStorageKey);
  } catch {
    // The row points at a file that is not there (database restored onto a fresh volume, file
    // removed by hand). A clean 404 the page can degrade against, not a 500.
    return NextResponse.json({ error: "Report not available" }, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      // Deliberately generic: the portal role cannot read the engagement, and a filename is one
      // more place a target business's name could leak into a downloads folder or a mail client.
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="due-diligence-report.pdf"`,
      // A token-scoped, revocable document must never be held by a shared cache: revocation has to
      // take effect immediately (spec.md §7), and a CDN copy would outlive it.
      "Cache-Control": "private, no-store, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
