"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { DealStage } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import { renderReportHtml, type AppendixDocument } from "@/lib/reports/renderHtml";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { putObject, getObject, deleteObject, reportPdfKey } from "@/lib/storage/objectStore";
import { logoContentTypeFor } from "@/lib/branding/logoContentType";
import { attributionFor } from "@/lib/storage/describeEvidence";
import { citationsByField } from "@/lib/audit/sourceRef";
import { parseFieldSchema } from "@/lib/templates/fieldSchema";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { recordMetric } from "@/lib/metrics/record";


/** "Pre-LOI" / "Post-LOI" / … for the report cover (spec.md §6). Mirrors the label map the
 * engagements list uses, so a consultant sees the same words in the app and in the deliverable;
 * duplicated rather than imported because that one lives in a page component. */
const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  PRE_LOI: "Pre-LOI",
  POST_LOI: "Post-LOI",
  CLOSING: "Closing",
  CLOSED: "Closed",
  DEAD: "Dead",
};

interface ResolvedLogo {
  /** For the PDF: Chromium has no session to fetch an app route with, so the bytes ride inline. */
  dataUri: string;
  /** The same bytes, kept so the brand snapshot below stores exactly what this PDF was built from. */
  bytes: Buffer;
  extension: string;
}

/** Best-effort: a missing/unreadable logo file should never block report generation, just render
 * without one — same reasoning as the ENOENT-tolerant reads elsewhere in the storage layer. */
async function resolveLogo(storageKey: string | null): Promise<ResolvedLogo | null> {
  if (!storageKey) return null;
  try {
    const bytes = await getObject(storageKey);
    // No logo rather than a guess. This previously fell back to image/png for an unrecognised
    // extension while the portal and the authenticated route both refused the same key — so one
    // logo could appear in the PDF and be absent from the portal chrome around it, which is the
    // one place the firm's brand is supposed to be identical. uploadOrgLogo now refuses a file
    // this cannot type, so reaching null here means a key stored before that check existed.
    const mime = logoContentTypeFor(storageKey);
    if (!mime) return null;
    const extension = storageKey.split(".").pop()?.toLowerCase() ?? "";
    return { dataUri: `data:${mime};base64,${bytes.toString("base64")}`, bytes, extension };
  } catch {
    return null;
  }
}

/**
 * Where a Report's own copy of the firm's logo lives — beside its PDF, under the same per-tenant
 * prefix `reportPdfKey` uses (src/lib/storage/local.ts), so a future move to object storage carries
 * both across unchanged.
 *
 * WHY A COPY, RATHER THAN POINTING AT THE ORG'S LIVE LOGO KEY
 * A Report is a point-in-time document (spec.md §6) and the PDF has these bytes baked in for good.
 * `orgLogoKey` derives its key from the uploaded filename, and uploadOrgLogo/removeOrgLogo delete
 * the previous object on re-upload — so a stored pointer to the org's key would dangle exactly when
 * a firm rebrands, i.e. the only case the snapshot exists for, and the portal would then show a
 * months-old report under a logo the PDF inside it contradicts. Bytes in the database row were the
 * other option and were rejected: `consultant_orgs` already sets the house rule ("Logo is a URL
 * into object storage, not inline bytes"), and base64 of a logo on every portal view's SELECT is a
 * cost paid on the buyer-facing path.
 */
function reportBrandLogoKey(orgId: string, reportId: string, extension: string): string {
  const safeExtension = /^[a-z0-9]{1,5}$/.test(extension) ? extension : "png";
  return `${orgId}/reports/${reportId}-logo.${safeExtension}`;
}

/**
 * Generates a Report snapshot for an Audit: computes the severity roll-up (spec.md §6), renders the
 * whitelabeled HTML, renders that to PDF, stores the PDF, and records a Report row pointing at it.
 * Each call creates a NEW Report row rather than updating a prior one — a Report is a snapshot "as
 * of" its generation date (spec.md §6's disclaimer language depends on this), not a live view.
 */
export async function generateReport(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const auditIdResult = z.string().min(1).safeParse(formData.get("auditId"));
  if (!auditIdResult.success) {
    throw new Error("Missing or invalid auditId.");
  }
  const auditId = auditIdResult.data;
  const includeAppendix = formData.get("includeAppendix") === "on";

  // Reads + the Report row creation happen in a short first transaction; everything requiring disk
  // I/O — resolving the logo to a data URI, PDF rendering (headless Chromium, can take several
  // seconds), and storing the rendered PDF — happens OUTSIDE any transaction, mirroring the fix
  // already applied to runTierAAutomation (src/lib/actions/audits.ts) — holding a Postgres connection
  // open that whole time is fine for one dev locally and a real connection-pool risk under concurrent
  // report generation across tenants.
  const { engagementId, reportId, orgId: reportOrgId, reportData } = await withOrgScope(orgId, async (tx) => {
    // findUnique, not findUniqueOrThrow: a foreign-org auditId resolves to zero rows under RLS, and
    // findUniqueOrThrow's raw PrismaClientKnownRequestError would crash instead of failing cleanly —
    // same class of bug found live via cross-tenant isolation testing on updateFinding. The org
    // lookup just below stays findUniqueOrThrow: orgId there is the session's own org (server-derived
    // from the JWT, not form input), so it failing would mean real DB corruption, not attacker input.
    const audit = await tx.audit.findUnique({
      where: { id: auditId },
      include: {
        engagement: true,
        template: true,
        findings: {
          include: {
            templateItem: true,
            evidence: { include: { uploadedBy: { select: { name: true, email: true } } } },
          },
        },
      },
    });
    if (!audit) {
      throw new Error("Audit not found.");
    }
    const org = await tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });

    // spec.md §6: the disclaimer is "required review by the consultant, not optional boilerplate the
    // product silently inserts without them seeing it" — refuse to generate until the org has
    // reviewed it once on /settings (src/lib/actions/org.ts's acknowledgeDisclaimer).
    if (!org.disclaimerAcknowledgedAt) {
      throw new Error(
        // Names WHO can resolve it rather than instructing the reader. Accepting liability
        // language on the firm's behalf is owner-only, so telling a member to go and do it sends
        // them to a control they cannot use — a firm-level prerequisite presenting as something
        // they got wrong.
        "This firm has not yet accepted the report disclaimer language. The account owner can do that on the Branding settings page.",
      );
    }

    const rollup = computeSeverityRollup(audit.findings);

    const report = await tx.report.create({
      data: {
        orgId,
        auditId,
        computedOverallSeverity: rollup.overall,
        overallCoveredCount: rollup.overallCoverage.rated,
        overallTotalCount: rollup.overallCoverage.total,
        // Brand-kit snapshot (spec.md §6). The firm name and accent are captured here, in the same
        // transaction that fixes the severity roll-up, because they are the same kind of fact: what
        // was true when this version of the document was produced. The logo key is filled in by the
        // update below, once its bytes have actually been copied outside the transaction.
        brandSnapshotFirmName: org.name,
        brandSnapshotColorHex: org.brandColorHex,
      },
    });

    // DOCUMENT-kind evidence only (spec.md §4's Evidence model: NOTE-kind evidence has no file
    // behind it) — just the metadata needed for the appendix's listed references, no file reads.
    const appendixDocuments: AppendixDocument[] = includeAppendix
      ? audit.findings.flatMap((f) =>
          f.evidence
            .filter((e) => e.storageKey && e.text)
            .map((e) => ({
              findingTitle: f.templateItem.title,
              tier: f.templateItem.tier,
              filename: e.text!,
              label: e.label,
              mimeType: e.mimeType,
              sizeBytes: e.sizeBytes,
              // A named professional, not "the consultant" — spec.md §4's attestation model rests
              // on the name. Null for rows attached before provenance was recorded.
              attributedTo: attributionFor(e.uploadedBy),
              attachedAt: e.createdAt,
            })),
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
        // spec.md §6's cover asks for the engagement date, and the Engagement has no column by that
        // name — its createdAt is when the deal was opened for diligence, which is the fact meant,
        // and a different one from generatedAt (when this Report version was produced).
        engagementDate: audit.engagement.createdAt,
        dealStage: DEAL_STAGE_LABEL[audit.engagement.dealStage] ?? null,
        // Read back off the Report row rather than from `org` again: these are now snapshot values,
        // and the PDF must be built from the same bytes the row records — otherwise a report could
        // be branded one way and its stored snapshot another.
        orgName: report.brandSnapshotFirmName ?? org.name,
        brandColorHex: report.brandSnapshotColorHex,
        brandLogoStorageKey: org.brandLogoUrl,
        findings: audit.findings.map((f) => {
          // Citations are keyed by fields the finding's own pinned template item declares, so a
          // citation against a field a later template version removed never reaches the report.
          const schema =
            f.templateItem.method === "MANUAL" ? parseFieldSchema(f.templateItem.fieldSchema) : null;
          return {
            ...f,
            evidenceCount: f.evidence.length,
            citations: schema
              ? citationsByField(f.evidence, new Set(schema.fields.map((field) => field.key)))
              : undefined,
          };
        }),
        overallRatingOverride: audit.overallRatingOverride,
        overallRatingOverrideNote: audit.overallRatingOverrideNote,
        appendixDocuments,
        // So the appendix can state when these documents are scheduled for deletion instead of
        // promising availability with no end — a promise that became false the moment a retention
        // run executed, in a document the buyer still holds.
        documentPurgeAt: audit.engagement.documentPurgeAt,
      },
    };
  });

  // Declared out here so the compensating delete below can clean up a copied logo whose Report row
  // is about to be removed.
  let brandLogoKey: string | null = null;

  try {
    const logo = await resolveLogo(reportData.brandLogoStorageKey);

    // The snapshot copy: the same bytes that are about to be baked into this PDF, stored under the
    // Report's own key so the portal can keep branding this document the way it was generated even
    // after the firm re-uploads or removes its logo. Best-effort, like resolving the logo itself —
    // a storage hiccup here leaves brandSnapshotLogoKey null and the portal falls back to the live
    // org logo, which is exactly the pre-snapshot behaviour, not a failure worth losing a report to.
    if (logo) {
      const candidateKey = reportBrandLogoKey(reportOrgId, reportId, logo.extension);
      try {
        await putObject(candidateKey, logo.bytes, logoContentTypeFor(candidateKey) ?? undefined);
        brandLogoKey = candidateKey;
      } catch {
        brandLogoKey = null;
      }
    }

    const html = renderReportHtml({
      businessName: reportData.businessName,
      templateName: reportData.templateName,
      generatedAt: reportData.generatedAt,
      engagementDate: reportData.engagementDate,
      dealStage: reportData.dealStage,
      org: {
        name: reportData.orgName,
        brandColorHex: reportData.brandColorHex,
        brandLogoDataUri: logo?.dataUri ?? null,
      },
      findings: reportData.findings,
      overallRatingOverride: reportData.overallRatingOverride,
      overallRatingOverrideNote: reportData.overallRatingOverrideNote,
      appendixDocuments: reportData.appendixDocuments,
      documentPurgeAt: reportData.documentPurgeAt,
    });

    const pdf = await renderHtmlToPdf(html);
    const key = reportPdfKey(reportOrgId, reportId);
    // This one the product authored, so the type is a fact rather than a claim.
    await putObject(key, pdf, "application/pdf");

    await withOrgScope(orgId, (tx) =>
      tx.report.update({
        where: { id: reportId },
        data: { pdfStorageKey: key, brandSnapshotLogoKey: brandLogoKey },
      }),
    );

    // Fires only after the PDF is stored — a report.generated event pointing at a Report the
    // compensating delete below is about to remove would be worse than no event. Not awaited:
    // best-effort delivery (spec.md §13.3) must never delay report generation itself.
    void dispatchWebhookEvent(orgId, {
      event: "report.generated",
      data: { reportId, auditId, engagementId, generatedAt: reportData.generatedAt.toISOString() },
    });
    void recordMetric("report.generated", { orgId, data: { reportId, auditId } });
  } catch (err) {
    // The Report row committed but rendering/storing the PDF didn't — remove the row rather than
    // leave a Report with no downloadable PDF behind (same compensating-delete pattern as
    // src/lib/actions/evidence.ts's attachEvidence), and surface the failure to the caller.
    await withOrgScope(orgId, (tx) => tx.report.delete({ where: { id: reportId } })).catch(() => {});
    // …and the logo copy taken for it, which nothing points at any more.
    if (brandLogoKey) await deleteObject(brandLogoKey).catch(() => {});
    throw err;
  }

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}
