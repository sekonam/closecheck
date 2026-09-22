"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email/send";
import { portalLink as portalLinkTemplate } from "@/lib/email/templates";

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

const emailPortalLinkSchema = z.object({
  linkId: z.string().min(1),
  recipientEmail: z.string().trim().toLowerCase().email("Enter a valid recipient email address"),
});

/**
 * Emails an existing Client Portal Link to a buyer-side recipient (docs/roadmap.md Phase 2.5 —
 * portal links were copy-paste-only before this). Deliberately a separate, explicit consultant
 * action rather than an auto-send on link creation: who on the buyer's side sees the report, and
 * when, is the consultant's call (spec.md §1 — the consultant owns the client relationship), not a
 * side effect. Only live links can be sent — emailing a revoked/expired URL would be handing the
 * buyer a dead end.
 */
export async function emailPortalLink(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const result = emailPortalLinkSchema.safeParse({
    linkId: formData.get("linkId"),
    recipientEmail: formData.get("recipientEmail"),
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid input.");
  }
  const { linkId, recipientEmail } = result.data;

  const { engagementId, auditId, businessName, token, expiresAt } = await withOrgScope(orgId, async (tx) => {
    const link = await tx.clientPortalLink.findUnique({
      where: { id: linkId },
      include: { report: { include: { audit: { include: { engagement: true } } } } },
    });
    if (!link) {
      throw new Error("Link not found.");
    }
    if (link.revokedAt) {
      throw new Error("That link has been revoked — create a new one to share this report.");
    }
    if (link.expiresAt.getTime() <= Date.now()) {
      throw new Error("That link has expired — create a new one to share this report.");
    }
    return {
      engagementId: link.report.audit.engagementId,
      auditId: link.report.auditId,
      businessName: link.report.audit.engagement.businessName,
      token: link.token,
      expiresAt: link.expiresAt,
    };
  });

  // Same absolute-URL base the emailed link must work from; the audit page renders the relative
  // /portal/<token> form of this exact path.
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const rendered = portalLinkTemplate({ businessName, url: `${base}/portal/${token}`, expiresAt });

  const sent = await sendEmail({
    orgId,
    to: recipientEmail,
    subject: rendered.subject,
    template: "portal-link",
    html: rendered.html,
    text: rendered.text,
  });
  if (sent.status === "FAILED") {
    throw new Error(`The email could not be delivered (${sent.error ?? "provider error"}). The link itself is still valid.`);
  }

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
