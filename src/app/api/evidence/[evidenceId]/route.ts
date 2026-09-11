import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/local";

export async function GET(_request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const { evidenceId } = await params;
  const { orgId } = await requireOrgSession();

  const evidence = await withOrgScope(orgId, (tx) => tx.evidence.findUnique({ where: { id: evidenceId } }));

  // RLS already prevents this from resolving another org's evidence; null here just means "not
  // found," not a tenant leak.
  if (!evidence || !evidence.storageKey) {
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  }

  const bytes = await getObject(evidence.storageKey);
  const filename = evidence.text ?? "evidence";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
}
