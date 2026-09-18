"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";

// 30 days, hardcoded — no UI for a custom expiry yet (v1 scope cut per spec.md §7's "time-boxed"
// requirement; the number itself isn't spec-mandated).
const LINK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const createPortalLinkSchema = z.object({
  reportId: z.string().min(1),
});

/**
 * Creates a Client Portal Link (spec.md §7) for an existing Report — normal authenticated-consultant
 * action via withOrgScope, NOT withPortalScope (src/lib/portal/db.ts), which is only for the
 * anonymous public-viewer path in src/app/portal/[token]/page.tsx.
 */
export async function createPortalLink(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const result = createPortalLinkSchema.safeParse({ reportId: formData.get("reportId") });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid report id.");
  }
  const { reportId } = result.data;

  // The token IS the entire access control for this link (spec.md §7: "magic-link, no account
  // required") — 24 random bytes (192 bits) base64url-encoded, not a sequential/guessable id.
  const token = randomBytes(24).toString("base64url");

  const { engagementId, auditId } = await withOrgScope(orgId, async (tx) => {
    // findUnique, not findUniqueOrThrow — same tamperable-id-crash-pattern fix as everywhere else
    // this session (e.g. src/lib/actions/audits.ts's updateFinding): a reportId for another org
    // resolves to zero rows under RLS, not a Postgres error.
    const report = await tx.report.findUnique({
      where: { id: reportId },
      include: { audit: true },
    });
    if (!report) {
      throw new Error("Report not found.");
    }

    await tx.clientPortalLink.create({
      data: {
        orgId,
        reportId,
        token,
        expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
      },
    });

    return { engagementId: report.audit.engagementId, auditId: report.auditId };
  });

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}

const revokePortalLinkSchema = z.object({
  linkId: z.string().min(1),
});

export async function revokePortalLink(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const result = revokePortalLinkSchema.safeParse({ linkId: formData.get("linkId") });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid link id.");
  }
  const { linkId } = result.data;

  const { engagementId, auditId } = await withOrgScope(orgId, async (tx) => {
    const link = await tx.clientPortalLink.findUnique({
      where: { id: linkId },
      include: { report: { include: { audit: true } } },
    });
    if (!link) {
      throw new Error("Link not found.");
    }

    await tx.clientPortalLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });

    return { engagementId: link.report.audit.engagementId, auditId: link.report.auditId };
  });

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
}
