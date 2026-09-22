"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { EvidenceKind, Tier } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { putObject, evidenceKey } from "@/lib/storage/local";
import { checkEvidenceContent, checkEvidenceUpload } from "@/lib/storage/uploadPolicy";

/**
 * Attaches an uploaded document as Evidence on a Finding (docs/spec.md §4, Tier B). The file itself
 * goes through src/lib/storage/local.ts (swap for real object storage before production, per
 * docs/spec.md §8's retention/encryption requirements — this is a local-dev stand-in only).
 */
export async function attachEvidence(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const findingIdResult = z.string().min(1).safeParse(formData.get("findingId"));
  if (!findingIdResult.success) {
    throw new Error("Missing or invalid findingId.");
  }
  const findingId = findingIdResult.data;
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    // Nothing selected — treat as a no-op rather than an error, since this form shares a page with
    // other forms and a stray empty submit shouldn't surface as a failure.
    return;
  }

  // Checked before the row is created and before any bytes are read into memory. docs/spec.md §8
  // calls these documents "the most sensitive data at rest", yet this path accepted any file of
  // any type at any size while the far lower-risk firm-logo upload already had both an allowlist
  // and a cap.
  const verdict = checkEvidenceUpload(file);
  if (!verdict.ok) {
    throw new Error(verdict.message);
  }

  const evidenceId = randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());

  // Second gate, now that the content is in hand: file.type is an assertion by the uploader, not a
  // fact, so the bytes have to match the claim.
  const contentVerdict = checkEvidenceContent(verdict.mimeType, bytes);
  if (!contentVerdict.ok) {
    throw new Error(contentVerdict.message);
  }

  const key = evidenceKey(orgId, findingId, evidenceId, file.name);

  // Confirms the finding belongs to this org and creates the Evidence row first, then writes the
  // file to disk only after that commits. Ordering matters: writing to disk *inside* the transaction
  // left an orphaned, unreferenced file on disk (invisible to purge-expired-documents.ts, which only
  // finds files by joining through Evidence rows) if a later statement rolled the transaction back.
  // Committing the row first means the only failure mode is the reverse — a row with no file — which
  // is compensated for below and which purge/download paths already treat as a tolerable ENOENT.
  const { engagementId, auditId } = await withOrgScope(orgId, async (tx) => {
    // findUnique, not findUniqueOrThrow: a foreign-org findingId resolves to zero rows under RLS,
    // and findUniqueOrThrow's raw PrismaClientKnownRequestError would crash instead of failing
    // cleanly — same class of bug found live via cross-tenant isolation testing on updateFinding.
    const finding = await tx.finding.findUnique({
      where: { id: findingId },
      include: { audit: true, templateItem: true },
    });
    if (!finding) {
      throw new Error("Finding not found.");
    }

    await tx.evidence.create({
      data: {
        id: evidenceId,
        orgId,
        findingId,
        // SCREENSHOT has existed in the schema since the first migration and nothing ever wrote
        // it — every upload was recorded as DOCUMENT regardless. A screenshot is the natural
        // artifact of a Tier C live-access check (spec.md §4's consultant-attested model).
        //
        // Classified from the item's TIER as well as the file being an image, not from the image
        // format alone. A consultant photographing an executed POS agreement with their phone
        // uploads an image too, and calling that a screenshot would be wrong in the way that
        // matters: the difference decides whether a report embeds the file inline or merely lists
        // it, and inlining a seller's contract into a document the buyer can forward is not a
        // decision this classification should make by accident. Tier C is the only tier whose
        // evidence is an observation of a screen.
        kind:
          verdict.isImage && finding.templateItem.tier === Tier.C
            ? EvidenceKind.SCREENSHOT
            : EvidenceKind.DOCUMENT,
        storageKey: key,
        text: file.name,
      },
    });

    return { engagementId: finding.audit.engagementId, auditId: finding.auditId };
  });

  try {
    await putObject(key, bytes);
  } catch (err) {
    // The row committed but the file didn't land — remove the row rather than leave Evidence
    // pointing at a file that will never exist, and surface the failure to the caller.
    await withOrgScope(orgId, (tx) => tx.evidence.delete({ where: { id: evidenceId } })).catch(() => {});
    throw err;
  }

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}

export async function deleteEvidence(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const evidenceIdResult = z.string().min(1).safeParse(formData.get("evidenceId"));
  if (!evidenceIdResult.success) {
    throw new Error("Missing or invalid evidenceId.");
  }
  const evidenceId = evidenceIdResult.data;

  const { engagementId, auditId } = await withOrgScope(orgId, async (tx) => {
    // findUnique, not findUniqueOrThrow — same reasoning as attachEvidence above.
    const evidence = await tx.evidence.findUnique({
      where: { id: evidenceId },
      include: { finding: { include: { audit: true } } },
    });
    if (!evidence) {
      throw new Error("Evidence not found.");
    }
    await tx.evidence.delete({ where: { id: evidenceId } });
    // Deliberately not deleting the underlying object from local storage here — matches
    // docs/spec.md §8's retention model (purge is a lifecycle-driven job, not an on-delete side
    // effect of removing one reference) and avoids a half-built deletion path that looks complete.
    return { engagementId: evidence.finding.audit.engagementId, auditId: evidence.finding.auditId };
  });

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}
