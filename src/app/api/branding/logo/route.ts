import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/objectStore";
import { logoContentTypeFor } from "@/lib/branding/logoContentType";
import { UNTRUSTED_CONTENT_CSP, fileResponseHeaders } from "@/lib/http/fileResponseHeaders";


/**
 * Serves the signed-in consultant's own org logo — there is no orgId/logoId in the route at all
 * (unlike /api/evidence/[evidenceId]), because there is exactly one logo per org and this route only
 * ever serves the caller's own (requireOrgSession + withOrgScope, same tenant-isolation bar as every
 * other tenant-data read). Used for the settings-page preview only; the PDF report embeds the logo as
 * a data URI instead (src/lib/actions/reports.ts) since the headless-Chromium renderer has no session
 * to authenticate a fetch back to this route with.
 */
export async function GET() {
  const { orgId } = await requireOrgSession();

  const org = await withOrgScope(orgId, (tx) => tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } }));
  if (!org.brandLogoUrl) {
    return NextResponse.json({ error: "No logo set" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await getObject(orgId, org.brandLogoUrl);
  } catch {
    return NextResponse.json({ error: "Logo file not found" }, { status: 404 });
  }

  // The security boundary for this route: it decides what Content-Type goes back, and a stored
  // file's name is not trustworthy independent of upload-time validation. Anything unrecognised —
  // ".svg" above all, which can carry script and executes on direct navigation even though this is
  // only ever used as an <img> src — falls back to a type no browser will render.
  const contentType = logoContentTypeFor(org.brandLogoUrl) ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(bytes), {
    // This route previously set only the content type and a bare `no-store`, while the other three
    // file-serving routes had all converged on nosniff, `private`, and a robots tag. Nothing had
    // gone wrong, and nothing signalled the difference either — which is why the invariants now
    // live in fileResponseHeaders rather than in each route's own judgement.
    //
    // `inline` is correct here specifically: this is consumed as an <img> src on the settings page.
    // What makes that safe is the content type, which comes from an extension allowlist that has
    // never included SVG — plus nosniff, so an unrecognised extension served as octet-stream
    // cannot be re-interpreted as markup on the app's own origin.
    headers: fileResponseHeaders({
      contentType,
      disposition: "inline",
      csp: UNTRUSTED_CONTENT_CSP,
    }),
  });
}
