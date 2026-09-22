import { withOrgScope } from "@/lib/db/scoped";
import { apiNotFound } from "@/lib/api/auth";
import { guardApiRequest, apiJson } from "@/lib/api/guard";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const audit = await withOrgScope(guard.auth.orgId, (tx) =>
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

  return apiJson({ audit }, guard.headers);
}
