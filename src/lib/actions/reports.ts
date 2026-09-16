"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import { renderReportHtml } from "@/lib/reports/renderHtml";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { putObject, reportPdfKey } from "@/lib/storage/local";

/**
 * Generates a Report snapshot for an Audit: computes the severity roll-up (spec.md §6), renders the
 * whitelabeled HTML, renders that to PDF, stores the PDF, and records a Report row pointing at it.
 * Each call creates a NEW Report row rather than updating a prior one — a Report is a snapshot "as
 * of" its generation date (spec.md §6's disclaimer language depends on this), not a live view.
 */
export async function generateReport(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const auditId = z.string().min(1).parse(formData.get("auditId"));

  // Reads + the Report row creation happen in a short first transaction; PDF rendering (headless
  // Chromium, can take several seconds) and the disk write happen OUTSIDE any transaction, mirroring
  // the fix already applied to runTierAAutomation (src/lib/actions/audits.ts) — holding a Postgres
  // connection open for the duration of a Chromium render is fine for one dev locally and a real
  // connection-pool risk under concurrent report generation across tenants.
  const { engagementId, reportId, orgId: reportOrgId, html } = await withOrgScope(orgId, async (tx) => {
    const audit = await tx.audit.findUniqueOrThrow({
      where: { id: auditId },
      include: {
        engagement: true,
        template: true,
        findings: { include: { templateItem: true, evidence: true } },
      },
    });
    const org = await tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });

    const rollup = computeSeverityRollup(audit.findings);

    const report = await tx.report.create({
      data: {
        orgId,
        auditId,
        computedOverallSeverity: rollup.overall,
        overallCoveredCount: rollup.overallCoverage.rated,
        overallTotalCount: rollup.overallCoverage.total,
      },
    });

    const html = renderReportHtml({
      businessName: audit.engagement.businessName,
      templateName: audit.template.name,
      generatedAt: report.generatedAt,
      org: { name: org.name, brandColorHex: org.brandColorHex, brandLogoUrl: org.brandLogoUrl },
      findings: audit.findings.map((f) => ({ ...f, evidenceCount: f.evidence.length })),
      overallRatingOverride: audit.overallRatingOverride,
      overallRatingOverrideNote: audit.overallRatingOverrideNote,
    });

    return { engagementId: audit.engagementId, reportId: report.id, orgId, html };
  });

  try {
    const pdf = await renderHtmlToPdf(html);
    const key = reportPdfKey(reportOrgId, reportId);
    await putObject(key, pdf);

    await withOrgScope(orgId, (tx) => tx.report.update({ where: { id: reportId }, data: { pdfStorageKey: key } }));
  } catch (err) {
    // The Report row committed but rendering/storing the PDF didn't — remove the row rather than
    // leave a Report with no downloadable PDF behind (same compensating-delete pattern as
    // src/lib/actions/evidence.ts's attachEvidence), and surface the failure to the caller.
    await withOrgScope(orgId, (tx) => tx.report.delete({ where: { id: reportId } })).catch(() => {});
    throw err;
  }

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}
