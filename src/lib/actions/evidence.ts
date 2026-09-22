"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { EvidenceKind, Tier } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { putObject, evidenceKey } from "@/lib/storage/objectStore";
import { checkEvidenceContent, checkEvidenceUpload } from "@/lib/storage/uploadPolicy";
import { parseSourceRef, withFieldCitation } from "@/lib/audit/sourceRef";
import { parseFieldSchema } from "@/lib/templates/fieldSchema";
import type { Prisma } from "@prisma/client";

/**
 * Attaches an uploaded document as Evidence on a Finding (docs/spec.md §4, Tier B). The file itself
 * goes through src/lib/storage/objectStore.ts, which selects a backend from configuration: the
 * local filesystem by default, S3-compatible object storage when a bucket is named. The instruction
 * that used to sit here — swap for real object storage before production — has been carried out,
 * and what remains is a deployment decision rather than a code change.
 */
export async function attachEvidence(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgSession();
  const findingIdResult = z.string().min(1).safeParse(formData.get("findingId"));
  if (!findingIdResult.success) {
    throw new Error("Missing or invalid findingId.");
  }
  const findingId = findingIdResult.data;
  const file = formData.get("file");
  // Optional: the consultant's own short name for the document. "Toast MSA, executed" is a better
  // thing to read in an appendix than "scan_0043.pdf", and the filename is often not theirs to
  // choose — it's whatever the seller's scanner produced.
  const labelRaw = formData.get("label");
  const label = typeof labelRaw === "string" && labelRaw.trim() !== "" ? labelRaw.trim().slice(0, 200) : null;

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
        label,
        // Both established by uploadPolicy, where the declared type and the file's own magic bytes
        // had to agree. Recorded rather than discarded: an appendix that lists bare filenames
        // gives a buyer's advisor nothing to check against.
        mimeType: verdict.mimeType,
        sizeBytes: file.size,
        // spec.md §4's Tier C model rests on a named professional attesting to what they saw, and
        // "the consultant" is not a name once a firm has more than one seat.
        uploadedById: userId,
      },
    });

    return { engagementId: finding.audit.engagementId, auditId: finding.auditId };
  });

  try {
    // verdict.mimeType, not file.type: the declared type is an assertion by the uploader and the
    // verdict is what the file's own leading bytes say it is (src/lib/storage/uploadPolicy.ts).
    // Storing the declared one would put the uploader's claim on the object and hand it back on
    // every download, which is the thing checkEvidenceContent exists to stop believing.
    await putObject(key, bytes, verdict.mimeType);
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

const citeEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  fieldKey: z.string().min(1).max(60),
  locator: z.string().max(120).optional(),
  excerpt: z.string().max(2000).optional(),
});

/**
 * Records where in a document a structured claim comes from.
 *
 * This is the step that turns "Transferable: no" into "Transferable: no — §14.2, p.7 of
 * toast-msa-2023.pdf: 'This Agreement may not be assigned…'", which a buyer's counsel can check
 * without asking anyone (docs/spec.md §2.1: the report is the product).
 *
 * Submitting both fields blank removes the citation for that field, which is how a consultant
 * corrects one they attached to the wrong clause.
 */
export async function citeEvidence(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const result = citeEvidenceSchema.safeParse({
    evidenceId: formData.get("evidenceId"),
    fieldKey: formData.get("fieldKey"),
    locator: formData.get("locator") || undefined,
    excerpt: formData.get("excerpt") || undefined,
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid citation.");
  }
  const parsed = result.data;

  const { engagementId, auditId } = await withOrgScope(orgId, async (tx) => {
    // findUnique, not findUniqueOrThrow — a foreign-org evidenceId resolves to zero rows under
    // RLS, same reasoning as the other actions in this file.
    const evidence = await tx.evidence.findUnique({
      where: { id: parsed.evidenceId },
      include: { finding: { include: { audit: true, templateItem: true } } },
    });
    if (!evidence) {
      throw new Error("Evidence not found.");
    }

    // The field must be one the finding's own pinned template item declares. Checking against the
    // row rather than the submitted form means a crafted POST cannot attach a citation to a field
    // that does not exist — the schema is the allowlist here exactly as it is for field values.
    const schema =
      evidence.finding.templateItem.method === "MANUAL"
        ? parseFieldSchema(evidence.finding.templateItem.fieldSchema)
        : null;
    if (!schema?.fields.some((field) => field.key === parsed.fieldKey)) {
      throw new Error("That field isn't part of this checklist item.");
    }

    const updated = withFieldCitation(parseSourceRef(evidence.sourceRef), parsed.fieldKey, {
      locator: parsed.locator,
      excerpt: parsed.excerpt,
    });

    await tx.evidence.update({
      where: { id: parsed.evidenceId },
      data: { sourceRef: updated as unknown as Prisma.InputJsonValue },
    });

    return {
      engagementId: evidence.finding.audit.engagementId,
      auditId: evidence.finding.auditId,
    };
  });

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}
