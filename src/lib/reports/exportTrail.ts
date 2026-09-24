import type { ScopedTx } from "@/lib/db/scoped";
import { attributionFor } from "@/lib/storage/describeEvidence";

/**
 * The consultant-side half of spec.md §8's access trail: who exported a report, and when.
 *
 * Portal views are logged per LINK and are deliberately unattributable — a buyer's advisor is not
 * identified, and the surface says so. Exports are the opposite on both counts: they belong to the
 * REPORT (a report can be exported before it is ever shared and after every link is revoked, so a
 * per-link trail has nowhere to put them), and they name a colleague. The two are kept in separate
 * helpers so the surface can keep them visibly distinct and neither caveat drifts onto the other.
 *
 * `actor` is resolved to a display string here rather than returned as a userId, so the surface
 * never does a second query per row; it is null when the person is gone (SET NULL on the relation),
 * because the export must outlive the exporter.
 */
export type ReportExport = { id: string; exportedAt: Date; reportId: string; actor: string | null };

export async function listReportExports(tx: ScopedTx, reportId: string): Promise<ReportExport[]> {
  const rows = await tx.reportExportEvent.findMany({
    where: { reportId },
    orderBy: { exportedAt: "desc" },
    include: { exportedBy: { select: { name: true, email: true } } },
  });
  return rows.map((r) => ({ id: r.id, exportedAt: r.exportedAt, reportId: r.reportId, actor: attributionFor(r.exportedBy) }));
}

/**
 * Records one export. Called inside the same org-scoped transaction as the metric insert in the
 * PDF route, and awaited: an export that is not recorded is the failure the trail exists to prevent.
 * RLS scopes the insert to the session's org; the report id has already resolved under that scope.
 */
export async function recordReportExport(tx: ScopedTx, orgId: string, reportId: string, userId: string): Promise<void> {
  await tx.reportExportEvent.create({ data: { orgId, reportId, exportedById: userId } });
}
