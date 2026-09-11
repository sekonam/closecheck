"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FindingStatus, Severity, type Prisma } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { isAutomatable, runTierACheck } from "@/lib/audit/tierA";

/**
 * Creates an Audit pinned to the currently-active version of the given Template slug
 * (docs/spec.md §5 — an in-progress Audit stays on the version it started on, even if the Template
 * is revised later) and instantiates one NOT_STARTED Finding per TemplateItem.
 */
export async function createAudit(formData: FormData) {
  const { orgId } = await requireOrgSession();
  const engagementId = z.string().min(1).parse(formData.get("engagementId"));
  const templateSlug = z.string().min(1).parse(formData.get("templateSlug"));

  // Templates are shared, non-tenant content (spec.md §5) — read directly, not via withOrgScope.
  const template = await prisma.template.findFirst({
    where: { slug: templateSlug, isActive: true },
    include: { items: true },
  });
  if (!template) throw new Error(`No active template found for slug "${templateSlug}"`);

  const audit = await withOrgScope(orgId, async (tx) => {
    // Confirm the engagement belongs to this org before creating anything under it — withOrgScope's
    // RLS policy would reject a cross-org write anyway, but failing with a clear error here beats a
    // raw Postgres RLS error surfacing to a user.
    const engagement = await tx.engagement.findUniqueOrThrow({ where: { id: engagementId } });

    return tx.audit.create({
      data: {
        orgId,
        engagementId: engagement.id,
        templateId: template.id,
        findings: {
          create: template.items.map((item) => ({
            orgId,
            templateItemId: item.id,
            status: FindingStatus.NOT_STARTED,
          })),
        },
      },
    });
  });

  revalidatePath(`/engagements/${engagementId}`);
  redirect(`/engagements/${engagementId}/audits/${audit.id}`);
}

/**
 * Runs every AUTOMATED Tier A item against the engagement's primaryDomain and writes the results
 * directly onto each Finding. Does nothing to MANUAL items — those stay whatever the consultant has
 * set. Safe to re-run: it always overwrites automated findings with a fresh check.
 */
export async function runTierAAutomation(formData: FormData) {
  const { orgId } = await requireOrgSession();
  const auditId = z.string().min(1).parse(formData.get("auditId"));

  await withOrgScope(orgId, async (tx) => {
    const audit = await tx.audit.findUniqueOrThrow({
      where: { id: auditId },
      include: { engagement: true, findings: { include: { templateItem: true } } },
    });

    const domain = audit.engagement.primaryDomain;
    if (!domain) {
      throw new Error("This engagement has no primary domain set — add one before running Tier A checks.");
    }

    const automatable = audit.findings.filter((f) => isAutomatable(f.templateItem.automationKey));

    // Sequential, not Promise.all: these are outbound network calls (WHOIS/DNS/TLS/HTTP) against a
    // third party's infrastructure — a handful of sequential requests for one domain is a
    // reasonable, low-impact rate; unbounded parallelism across many findings is not, and this is
    // exactly the kind of check-then-act code path .claude/skills/domain-code-review/SKILL.md asks
    // to look at for anything touching an external target.
    for (const finding of automatable) {
      const result = await runTierACheck(finding.templateItem.automationKey!, domain);
      await tx.finding.update({
        where: { id: finding.id },
        data: {
          status: result.status,
          severity: result.severity,
          note: result.note,
          structuredData: result.structuredData as Prisma.InputJsonValue,
        },
      });
    }
  });

  const audit = await prisma.audit.findUniqueOrThrow({ where: { id: auditId } });
  revalidatePath(`/engagements/${audit.engagementId}/audits/${auditId}`);
}

const updateFindingSchema = z.object({
  findingId: z.string().min(1),
  status: z.nativeEnum(FindingStatus),
  severity: z.nativeEnum(Severity).optional(),
  note: z.string().optional(),
  // Contract-specific structured fields (docs/spec.md §4, Tier B) — only rendered in the UI for the
  // POS/online-ordering contract items, but accepted generically here rather than gated by title so
  // this action doesn't need to know which items are "contract-shaped."
  transferable: z.enum(["yes", "no", "unclear"]).optional(),
  penaltyAmount: z.string().optional(),
  penaltyBasis: z.string().optional(),
});

export async function updateFinding(formData: FormData) {
  const { orgId } = await requireOrgSession();
  const parsed = updateFindingSchema.parse({
    findingId: formData.get("findingId"),
    status: formData.get("status"),
    severity: formData.get("severity") || undefined,
    note: formData.get("note") || undefined,
    transferable: formData.get("transferable") || undefined,
    penaltyAmount: formData.get("penaltyAmount") || undefined,
    penaltyBasis: formData.get("penaltyBasis") || undefined,
  });

  const hasStructuredFields = parsed.transferable || parsed.penaltyAmount || parsed.penaltyBasis;

  const updated = await withOrgScope(orgId, (tx) =>
    tx.finding.update({
      where: { id: parsed.findingId },
      data: {
        status: parsed.status,
        severity: parsed.severity ? parsed.severity : null,
        note: parsed.note ?? null,
        // Only touch structuredData when this submit actually carried one of the contract fields —
        // omitting the key here (rather than writing null/{}) leaves Tier A's automated check
        // output on other findings untouched, since this same action is shared by every finding's
        // form regardless of tier or method.
        ...(hasStructuredFields
          ? {
              structuredData: {
                transferable: parsed.transferable ?? null,
                penaltyAmount: parsed.penaltyAmount ?? null,
                penaltyBasis: parsed.penaltyBasis ?? null,
              } satisfies Prisma.InputJsonValue,
            }
          : {}),
      },
      include: { audit: true },
    }),
  );

  revalidatePath(`/engagements/${updated.audit.engagementId}/audits/${updated.audit.id}`);
}

const updateAuditOverrideSchema = z.object({
  auditId: z.string().min(1),
  overallRatingOverride: z.nativeEnum(Severity).optional(),
  overallRatingOverrideNote: z.string().optional(),
});

/**
 * Sets or clears the consultant's override of the computed overall rating (docs/spec.md §6). The
 * computed rating itself is never stored as overridden — src/lib/reports/renderHtml.ts always
 * recomputes it fresh and shows both, per the spec's transparency requirement.
 */
export async function updateAuditOverride(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const parsed = updateAuditOverrideSchema.parse({
    auditId: formData.get("auditId"),
    overallRatingOverride: formData.get("overallRatingOverride") || undefined,
    overallRatingOverrideNote: formData.get("overallRatingOverrideNote") || undefined,
  });

  const updated = await withOrgScope(orgId, (tx) =>
    tx.audit.update({
      where: { id: parsed.auditId },
      data: {
        overallRatingOverride: parsed.overallRatingOverride ?? null,
        overallRatingOverrideNote: parsed.overallRatingOverrideNote ?? null,
      },
    }),
  );

  revalidatePath(`/engagements/${updated.engagementId}/audits/${updated.id}`);
}
