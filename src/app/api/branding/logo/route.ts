import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/local";

// No svg: uploadOrgLogo (src/lib/actions/org.ts) rejects SVG at write time, but this map is the
// actual security boundary — it decides what Content-Type gets served back, and a stored file's
// name/extension is attacker-controlled independent of whatever validation ran at upload time. An
// SVG served as image/svg+xml can carry a <script> that executes on direct navigation to this route
// (not when used in an <img> src, which is how this is actually used, but the route doesn't prevent
// direct navigation) — falling back to application/octet-stream for anything unrecognized, including
// ".svg", keeps that closed regardless of what upload-time validation does or doesn't catch.
const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

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

  const extension = org.brandLogoUrl.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXTENSION_CONTENT_TYPE[extension] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      // Always fetch fresh — the settings page just wrote a possibly-new logo under the same URL.
      "Cache-Control": "no-store",
    },
  });
}
