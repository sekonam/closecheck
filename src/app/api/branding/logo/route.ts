import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/local";

const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
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
