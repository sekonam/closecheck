import { withOrgScope } from "@/lib/db/scoped";
import { apiNotFound } from "@/lib/api/auth";
import { guardApiRequest, apiJson } from "@/lib/api/guard";

/**
 * Report METADATA only (docs/spec.md §13.2) — the rendered PDF stays behind the interactive app's
 * authenticated download route; the API's job is letting a firm's tooling know a report exists and
 * what it concluded, not becoming a second document-distribution channel.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const report = await withOrgScope(guard.auth.orgId, (tx) =>
    tx.report.findUnique({
      where: { id },
      select: {
        id: true,
        auditId: true,
        computedOverallSeverity: true,
        overallCoveredCount: true,
        overallTotalCount: true,
        generatedAt: true,
        audit: { select: { engagementId: true } },
      },
    }),
  );
  if (!report) return apiNotFound();

  return apiJson(
    {
      report: {
        id: report.id,
        auditId: report.auditId,
        engagementId: report.audit.engagementId,
        computedOverallSeverity: report.computedOverallSeverity,
        overallCoveredCount: report.overallCoveredCount,
        overallTotalCount: report.overallTotalCount,
        generatedAt: report.generatedAt,
      },
    },
    guard.headers,
  );
}
