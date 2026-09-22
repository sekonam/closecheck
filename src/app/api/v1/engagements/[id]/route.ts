import { withOrgScope } from "@/lib/db/scoped";
import { apiNotFound } from "@/lib/api/auth";
import { guardApiRequest, apiJson } from "@/lib/api/guard";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const engagement = await withOrgScope(guard.auth.orgId, (tx) =>
    // findUnique, not findUniqueOrThrow — a foreign-org id resolves to zero rows under RLS and must
    // be a clean 404, not a crash (same convention as the app's server actions).
    tx.engagement.findUnique({
      where: { id },
      select: {
        id: true,
        businessName: true,
        primaryDomain: true,
        dealStage: true,
        createdAt: true,
        updatedAt: true,
        audits: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            template: { select: { slug: true, version: true, name: true } },
          },
        },
      },
    }),
  );
  if (!engagement) return apiNotFound();

  return apiJson({ engagement }, guard.headers);
}
