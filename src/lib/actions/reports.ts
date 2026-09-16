"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import { renderReportHtml, type AppendixDocument } from "@/lib/reports/renderHtml";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { putObject, getObject, reportPdfKey } from "@/lib/storage/local";

const LOGO_EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** Best-effort: a missing/unreadable logo file should never block report generation, just render
 * without one — same reasoning as the ENOENT-tolerant reads elsewhere in the storage layer. */
async function resolveLogoDataUri(storageKey: string | null): Promise<string | null> {
  if (!storageKey) return null;
  try {
    const bytes = await getObject(storageKey);
    const extension = storageKey.split(".").pop()?.toLowerCase() ?? "";
    const mime = LOGO_EXTENSION_MIME[extension] ?? "image/png";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Generates a Report snapshot for an Audit: computes the severity roll-up (spec.md §6), renders the
 * whitelabeled HTML, renders that to PDF, stores the PDF, and records a Report row pointing at it.
 * Each call creates a NEW Report row rather than updating a prior one — a Report is a snapshot "as
 * of" its generation date (spec.md §6's disclaimer language depends on this), not a live view.
 */
export async function generateReport(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const auditId = z.string().min(1).parse(formData.get("auditId"));
  const includeAppendix = formData.get("includeAppendix") === "on";

  // Reads + the Report row creation happen in a short first transaction; everything requiring disk
  // I/O — resolving the logo to a data URI, PDF rendering (headless Chromium, can take several
  // seconds), and storing the rendered PDF — happens OUTSIDE any transaction, mirroring the fix
  // already applied to runTierAAutomation (src/lib/actions/audits.ts) — holding a Postgres connection
  // open that whole time is fine for one dev locally and a real connection-pool risk under concurrent
  // report generation across tenants.
  const { engagementId, reportId, orgId: reportOrgId, reportData } = await withOrgScope(orgId, async (tx) => {
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

    // DOCUMENT-kind evidence only (spec.md §4's Evidence model: NOTE-kind evidence has no file
    // behind it) — just the metadata needed for the appendix's listed references, no file reads.
    const appendixDocuments: AppendixDocument[] = includeAppendix
      ? audit.findings.flatMap((f) =>
          f.evidence
            .filter((e) => e.storageKey && e.text)
            .map((e) => ({ findingTitle: f.templateItem.title, tier: f.templateItem.tier, filename: e.text! })),
        )
      : [];

    return {
      engagementId: audit.engagementId,
      reportId: report.id,
      orgId,
      reportData: {
        businessName: audit.engagement.businessName,
        templateName: audit.template.name,
        generatedAt: report.generatedAt,
        orgName: org.name,
        brandColorHex: org.brandColorHex,
        brandLogoStorageKey: org.brandLogoUrl,
        findings: audit.findings.map((f) => ({ ...f, evidenceCount: f.evidence.length })),
        overallRatingOverride: audit.overallRatingOverride,
        overallRatingOverrideNote: audit.overallRatingOverrideNote,
        appendixDocuments,
      },
    };
  });

  try {
    const brandLogoDataUri = await resolveLogoDataUri(reportData.brandLogoStorageKey);
    const html = renderReportHtml({
      businessName: reportData.businessName,
      templateName: reportData.templateName,
      generatedAt: reportData.generatedAt,
      org: { name: reportData.orgName, brandColorHex: reportData.brandColorHex, brandLogoDataUri },
      findings: reportData.findings,
      overallRatingOverride: reportData.overallRatingOverride,
      overallRatingOverrideNote: reportData.overallRatingOverrideNote,
      appendixDocuments: reportData.appendixDocuments,
    });

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
