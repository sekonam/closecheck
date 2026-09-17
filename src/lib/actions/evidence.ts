"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { EvidenceKind } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { putObject, evidenceKey } from "@/lib/storage/local";

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

  const evidenceId = randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());
  const key = evidenceKey(orgId, findingId, evidenceId, file.name);

  // Confirms the finding belongs to this org and creates the Evidence row first, then writes the
  // file to disk only after that commits. Ordering matters: writing to disk *inside* the transaction
  // left an orphaned, unreferenced file on disk (invisible to purge-expired-documents.ts, which only
  // finds files by joining through Evidence rows) if a later statement rolled the transaction back.
  // Committing the row first means the only failure mode is the reverse — a row with no file — which
  // is compensated for below and which purge/download paths already treat as a tolerable ENOENT.
  const { engagementId, auditId } = await withOrgScope(orgId, async (tx) => {
    const finding = await tx.finding.findUniqueOrThrow({
      where: { id: findingId },
      include: { audit: true },
    });

    await tx.evidence.create({
      data: {
        id: evidenceId,
        orgId,
        findingId,
        kind: EvidenceKind.DOCUMENT,
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
    const evidence = await tx.evidence.findUniqueOrThrow({
      where: { id: evidenceId },
      include: { finding: { include: { audit: true } } },
    });
    await tx.evidence.delete({ where: { id: evidenceId } });
    // Deliberately not deleting the underlying object from local storage here — matches
    // docs/spec.md §8's retention model (purge is a lifecycle-driven job, not an on-delete side
    // effect of removing one reference) and avoids a half-built deletion path that looks complete.
    return { engagementId: evidence.finding.audit.engagementId, auditId: evidence.finding.auditId };
  });

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}
