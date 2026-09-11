import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/local";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const { orgId } = await requireOrgSession();

  const report = await withOrgScope(orgId, (tx) =>
    tx.report.findUnique({ where: { id: reportId }, include: { audit: { include: { engagement: true } } } }),
  );

  // withOrgScope's RLS policy already prevents this from resolving a different org's report; the
  // null check below is "not found" (wrong id, or genuinely not generated yet), not a tenant leak.
  if (!report || !report.pdfStorageKey) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const pdf = await getObject(report.pdfStorageKey);
  const filename = `closecheck-${report.audit.engagement.businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${report.id}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
