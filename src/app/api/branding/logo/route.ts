import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/objectStore";
import { logoContentTypeFor } from "@/lib/branding/logoContentType";


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
    bytes = await getObject(org.brandLogoUrl);
  } catch {
    return NextResponse.json({ error: "Logo file not found" }, { status: 404 });
  }

  // The security boundary for this route: it decides what Content-Type goes back, and a stored
  // file's name is not trustworthy independent of upload-time validation. Anything unrecognised —
  // ".svg" above all, which can carry script and executes on direct navigation even though this is
  // only ever used as an <img> src — falls back to a type no browser will render.
  const contentType = logoContentTypeFor(org.brandLogoUrl) ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      // Always fetch fresh — the settings page just wrote a possibly-new logo under the same URL.
      "Cache-Control": "no-store",
    },
  });
}
