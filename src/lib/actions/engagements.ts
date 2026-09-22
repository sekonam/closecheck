"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DealStage } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { normalizeDomain, validatePrimaryDomain } from "@/lib/validation/domain";
import { TERMINAL_DEAL_STAGES, defaultPurgeDateFor } from "@/lib/retention/policy";

const createEngagementSchema = z.object({
  // Trimmed before the length check — otherwise a whitespace-only name passes validation and saves,
  // leaving an engagement/report with a name that renders blank everywhere it's displayed.
  businessName: z.string().trim().min(1, "Business name is required"),
  primaryDomain: z
    .string()
    .trim()
    .transform(normalizeDomain)
    .superRefine((domain, ctx) => {
      const verdict = validatePrimaryDomain(domain);
      if (!verdict.ok) ctx.addIssue({ code: "custom", message: verdict.message });
    })
    .optional(),
});

export async function createEngagement(formData: FormData) {
  const { orgId } = await requireOrgSession();

  const result = createEngagementSchema.safeParse({
    businessName: formData.get("businessName"),
    primaryDomain: formData.get("primaryDomain") || undefined,
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid engagement input.");
  }
  const parsed = result.data;

  const engagement = await withOrgScope(orgId, (tx) =>
    tx.engagement.create({
      data: {
        orgId,
        businessName: parsed.businessName,
        primaryDomain: parsed.primaryDomain || null,
      },
    }),
  );

  revalidatePath("/engagements");
  redirect(`/engagements/${engagement.id}`);
}

const updateEngagementSchema = z.object({
  engagementId: z.string().min(1),
  // Trimmed before the length check — otherwise a whitespace-only name passes validation and saves,
  // leaving an engagement/report with a name that renders blank everywhere it's displayed.
  businessName: z.string().trim().min(1, "Business name is required"),
  // Blank means "clear the domain" here, same as create — there is no separate "leave unchanged"
  // affordance in a plain text input, and that's the right default: re-submitting the form with the
  // field emptied is the only way a consultant has to remove a domain they'd previously set.
  primaryDomain: z
    .string()
    .trim()
    .transform(normalizeDomain)
    .superRefine((domain, ctx) => {
      const verdict = validatePrimaryDomain(domain);
      if (!verdict.ok) ctx.addIssue({ code: "custom", message: verdict.message });
    })
    .optional(),
  dealStage: z.nativeEnum(DealStage),
  // docs/spec.md §8: "consultant-configurable deletion policy" — the consultant sets the actual
  // purge date directly rather than us computing one from a hardcoded N-days constant. Blank clears
  // it (no purge scheduled), same reasoning as primaryDomain above.
  documentPurgeAt: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const parsed = new Date(v);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({ code: "custom", message: "Enter a valid purge date." });
        return undefined;
      }
      return parsed;
    }),
});

/**
 * The only way to change an Engagement after creation — including adding a primaryDomain to one
 * created without it, which otherwise permanently blocks Tier A automation for that Engagement
 * (found via UI testing: the app had no edit path at all before this).
 */
export async function updateEngagement(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const result = updateEngagementSchema.safeParse({
    engagementId: formData.get("engagementId"),
    businessName: formData.get("businessName"),
    primaryDomain: formData.get("primaryDomain") || undefined,
    dealStage: formData.get("dealStage"),
    documentPurgeAt: formData.get("documentPurgeAt") || undefined,
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid engagement input.");
  }
  const parsed = result.data;

  await withOrgScope(orgId, async (tx) => {
    // findUnique-then-check rather than update() directly: a foreign-org engagementId resolves to
    // zero rows under RLS, and update() on zero rows throws a raw PrismaClientKnownRequestError
    // that surfaces to the user as a Prisma error string. Every other mutating action in this
    // codebase already does it this way; this one was the exception.
    const existing = await tx.engagement.findUnique({ where: { id: parsed.engagementId } });
    if (!existing) {
      throw new Error("Engagement not found.");
    }

    // docs/spec.md §8's "no indefinite default retention", which the schema comment on
    // Engagement.documentPurgeAt has always asserted and nothing implemented: the field was only
    // ever written from this form, so a consultant who moved a deal to DEAD and left the date
    // blank — which is the default state of that input, and easy to miss — kept the seller's
    // contracts and merchant statements forever, with no job that would ever find them.
    //
    // Only fills a date that isn't already set, and only on the transition into a terminal stage.
    // An explicit value the consultant typed always wins, including a deliberate blank on an
    // engagement that was already closed.
    const enteringTerminalStage =
      TERMINAL_DEAL_STAGES.includes(parsed.dealStage) && !TERMINAL_DEAL_STAGES.includes(existing.dealStage);
    const documentPurgeAt =
      parsed.documentPurgeAt ??
      (enteringTerminalStage && !existing.documentPurgeAt
        ? defaultPurgeDateFor(parsed.dealStage, new Date())
        : null);

    await tx.engagement.update({
      where: { id: parsed.engagementId },
      data: {
        businessName: parsed.businessName,
        primaryDomain: parsed.primaryDomain || null,
        dealStage: parsed.dealStage,
        documentPurgeAt,
      },
    });
  });

  revalidatePath(`/engagements/${parsed.engagementId}`);
  revalidatePath("/engagements");
}
