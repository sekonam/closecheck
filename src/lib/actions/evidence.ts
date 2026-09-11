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
  const findingId = z.string().min(1).parse(formData.get("findingId"));
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    // Nothing selected — treat as a no-op rather than an error, since this form shares a page with
    // other forms and a stray empty submit shouldn't surface as a failure.
    return;
  }

  const evidenceId = randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());
  const key = evidenceKey(orgId, findingId, evidenceId, file.name);

  const { engagementId, auditId } = await withOrgScope(orgId, async (tx) => {
    // Confirms the finding belongs to this org before writing anything to disk under its id.
    const finding = await tx.finding.findUniqueOrThrow({
      where: { id: findingId },
      include: { audit: true },
    });

    await putObject(key, bytes);

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

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}

export async function deleteEvidence(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const evidenceId = z.string().min(1).parse(formData.get("evidenceId"));

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
