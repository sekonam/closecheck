import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { authenticateApiRequest, apiUnauthorized, apiNotFound } from "@/lib/api/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth) return apiUnauthorized();
  const { id } = await params;

  const audit = await withOrgScope(auth.orgId, (tx) =>
    tx.audit.findUnique({
      where: { id },
      select: {
        id: true,
        engagementId: true,
        status: true,
        overallRatingOverride: true,
        overallRatingOverrideNote: true,
        createdAt: true,
        updatedAt: true,
        template: { select: { slug: true, version: true, name: true } },
        findings: {
          orderBy: { templateItem: { sortOrder: "asc" } },
          select: {
            id: true,
            status: true,
            severity: true,
            note: true,
            updatedAt: true,
            templateItem: { select: { tier: true, method: true, title: true } },
          },
        },
      },
    }),
  );
  if (!audit) return apiNotFound();

  return NextResponse.json({ audit });
}
