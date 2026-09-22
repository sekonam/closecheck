import { withOrgScope } from "@/lib/db/scoped";
import { apiNotFound } from "@/lib/api/auth";
import { guardApiRequest, apiJson } from "@/lib/api/guard";
import { computeSeverityRollup } from "@/lib/reports/rollup";

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

  /**
   * The computed roll-up is returned ALONGSIDE the consultant's override, never in place of it.
   *
   * spec.md §6 and the domain-code-review checklist both require the computed value to remain
   * visible wherever an override is shown — the override annotates the computation, it does not
   * replace it. The Audit row stores only the override (the computed value is persisted just on
   * Report.computedOverallSeverity, at generation time), so returning the row as-is gave an API
   * consumer the consultant's conclusion with no way to see what the evidence said, and no report
   * to fall back on for an audit that has not generated one yet. Recomputing here from the
   * findings already being selected costs nothing and keeps that guarantee true on every access
   * path, not just the ones with a UI.
   *
   * Coverage travels with it for the reason computeSeverityRollup's own comment gives: a brand-new
   * audit with nothing rated rolls up to GREEN, and "GREEN because nothing has been checked" must
   * never be indistinguishable from "GREEN because it passed."
   */
  const rollup = computeSeverityRollup(audit.findings);

  return apiJson(
    {
      audit: {
        ...audit,
        computedOverallSeverity: rollup.overall,
        computedPerTierSeverity: rollup.perTier,
        coverage: rollup.overallCoverage,
        perTierCoverage: rollup.perTierCoverage,
      },
    },
    guard.headers,
  );
}
