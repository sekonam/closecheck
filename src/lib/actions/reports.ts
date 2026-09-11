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

  const { engagementId } = await withOrgScope(orgId, async (tx) => {
    const audit = await tx.audit.findUniqueOrThrow({
      where: { id: auditId },
      include: {
        engagement: true,
        template: true,
        findings: { include: { templateItem: true } },
      },
    });
    const org = await tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });

    const rollup = computeSeverityRollup(audit.findings);

    const report = await tx.report.create({
      data: { orgId, auditId, computedOverallSeverity: rollup.overall },
    });

    const html = renderReportHtml({
      businessName: audit.engagement.businessName,
      templateName: audit.template.name,
      generatedAt: report.generatedAt,
      org: { name: org.name, brandColorHex: org.brandColorHex, brandLogoUrl: org.brandLogoUrl },
      findings: audit.findings,
      overallRatingOverride: audit.overallRatingOverride,
      overallRatingOverrideNote: audit.overallRatingOverrideNote,
    });

    const pdf = await renderHtmlToPdf(html);
    const key = reportPdfKey(orgId, report.id);
    await putObject(key, pdf);

    await tx.report.update({ where: { id: report.id }, data: { pdfStorageKey: key } });

    return { engagementId: audit.engagementId };
  });

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}
