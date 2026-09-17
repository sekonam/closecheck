"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FindingStatus, Severity, type Prisma } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { isAutomatable, runTierACheck } from "@/lib/audit/tierA";
import { isContractItem } from "@/lib/audit/contractItem";

/**
 * Creates an Audit pinned to the currently-active version of the given Template slug
 * (docs/spec.md §5 — an in-progress Audit stays on the version it started on, even if the Template
 * is revised later) and instantiates one NOT_STARTED Finding per TemplateItem.
 */
export async function createAudit(formData: FormData) {
  const { orgId } = await requireOrgSession();
  const engagementIdResult = z.string().min(1).safeParse(formData.get("engagementId"));
  if (!engagementIdResult.success) {
    throw new Error("Missing or invalid engagementId.");
  }
  const engagementId = engagementIdResult.data;
  const templateSlugResult = z.string().min(1).safeParse(formData.get("templateSlug"));
  if (!templateSlugResult.success) {
    throw new Error("Missing or invalid templateSlug.");
  }
  const templateSlug = templateSlugResult.data;

  // Templates are shared, non-tenant content (spec.md §5) — read directly, not via withOrgScope.
  const template = await prisma.template.findFirst({
    where: { slug: templateSlug, isActive: true },
    include: { items: true },
  });
  if (!template) throw new Error(`No active template found for slug "${templateSlug}"`);

  const audit = await withOrgScope(orgId, async (tx) => {
    // Confirm the engagement belongs to this org before creating anything under it — withOrgScope's
    // RLS policy would reject a cross-org write anyway, but failing with a clear error here beats a
    // raw crash surfacing to a user. findUnique, not findUniqueOrThrow: a foreign-org engagementId
    // resolves to zero rows under RLS (not a Postgres error), and findUniqueOrThrow's raw
    // PrismaClientKnownRequestError (P2025) would still crash to Next's default 500 page otherwise.
    const engagement = await tx.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement) {
      throw new Error("Engagement not found.");
    }

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
  const auditIdResult = z.string().min(1).safeParse(formData.get("auditId"));
  if (!auditIdResult.success) {
    throw new Error("Missing or invalid auditId.");
  }
  const auditId = auditIdResult.data;

  // Reads the finding list and target domain in a short first transaction, then runs the outbound
  // checks OUTSIDE any transaction, then writes results back in a second short transaction. Found
  // via UI testing: the original version ran the WHOIS/DNS/TLS/HTTP calls (which can take several
  // seconds combined) inside a single withOrgScope transaction, holding a Postgres connection idle
  // the whole time — fine for one dev locally, a real problem under any concurrent load.
  const { domain, automatable, engagementId } = await withOrgScope(orgId, async (tx) => {
    // findUnique, not findUniqueOrThrow: a foreign-org auditId resolves to zero rows under RLS, and
    // findUniqueOrThrow's raw PrismaClientKnownRequestError would crash instead of failing cleanly —
    // same class of bug found live via cross-tenant isolation testing on updateFinding.
    const audit = await tx.audit.findUnique({
      where: { id: auditId },
      include: { engagement: true, findings: { include: { templateItem: true } } },
    });
    if (!audit) {
      throw new Error("Audit not found.");
    }

    const domain = audit.engagement.primaryDomain;
    if (!domain) {
      throw new Error("This engagement has no primary domain set — add one before running Tier A checks.");
    }

    return {
      domain,
      engagementId: audit.engagementId,
      automatable: audit.findings
        .filter((f) => isAutomatable(f.templateItem.automationKey))
        .map((f) => ({ id: f.id, automationKey: f.templateItem.automationKey!, updatedAt: f.updatedAt })),
    };
  });

  // Sequential, not Promise.all: these are outbound network calls against a third party's
  // infrastructure — a handful of sequential requests for one domain is a reasonable, low-impact
  // rate; unbounded parallelism across many findings is not, and this is exactly the kind of
  // check-then-act code path .claude/skills/domain-code-review/SKILL.md asks to look at for
  // anything touching an external target.
  const results: Array<{ findingId: string; capturedUpdatedAt: Date; result: Awaited<ReturnType<typeof runTierACheck>> }> = [];
  for (const finding of automatable) {
    results.push({
      findingId: finding.id,
      capturedUpdatedAt: finding.updatedAt,
      result: await runTierACheck(finding.automationKey, domain),
    });
  }

  await withOrgScope(orgId, async (tx) => {
    for (const { findingId, capturedUpdatedAt, result } of results) {
      // Guards against clobbering a manual edit made while the (multi-second) outbound checks above
      // were in flight: only overwrite if the row is still exactly as it was when read. A 0-count
      // result means a consultant edited this finding in the gap — leave their edit alone rather
      // than silently discarding it with a fresher-but-unwanted automated result.
      await tx.finding.updateMany({
        where: { id: findingId, updatedAt: capturedUpdatedAt },
        data: {
          status: result.status,
          severity: result.severity,
          note: result.note,
          structuredData: result.structuredData as Prisma.InputJsonValue,
        },
      });
    }
  });

  revalidatePath(`/engagements/${engagementId}/audits/${auditId}`);
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
  const result = updateFindingSchema.safeParse({
    findingId: formData.get("findingId"),
    status: formData.get("status"),
    severity: formData.get("severity") || undefined,
    note: formData.get("note") || undefined,
    transferable: formData.get("transferable") || undefined,
    penaltyAmount: formData.get("penaltyAmount") || undefined,
    penaltyBasis: formData.get("penaltyBasis") || undefined,
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid finding update.");
  }
  const parsed = result.data;

  const updated = await withOrgScope(orgId, async (tx) => {
    // Whether this submit is allowed to touch structuredData is decided from the finding's own
    // templateItem title — the same check the UI uses to decide whether to render the contract
    // fields at all (src/lib/audit/contractItem.ts) — never from whether the posted values happen
    // to be non-empty. Gating on posted-value truthiness meant a consultant clearing all three
    // fields back to blank (a legitimate correction) silently left the stale structuredData in
    // place, since an all-empty submission looked identical to "this form doesn't have these
    // fields." Gating on the finding's actual shape also closes off writing contract-shaped
    // structuredData onto an unrelated (e.g. Tier A automated) finding via a crafted submission.
    // findUnique, not findUniqueOrThrow: a findingId for another org resolves to zero rows under
    // RLS (not a Postgres policy error, just an empty result), so findUniqueOrThrow's raw
    // PrismaClientKnownRequestError (P2025) would crash to Next's default 500 page instead of a
    // clean message — found live via cross-tenant IDOR testing with a real foreign findingId.
    const existing = await tx.finding.findUnique({
      where: { id: parsed.findingId },
      include: { templateItem: true },
    });
    if (!existing) {
      throw new Error("Finding not found.");
    }
    const isContractFinding = isContractItem(existing.templateItem.title);

    return tx.finding.update({
      where: { id: parsed.findingId },
      data: {
        status: parsed.status,
        severity: parsed.severity ? parsed.severity : null,
        note: parsed.note ?? null,
        // Omitting the key here (rather than writing null/{}) leaves Tier A's automated check
        // output on other findings untouched, since this same action is shared by every finding's
        // form regardless of tier or method.
        ...(isContractFinding
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
    });
  });

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
  const result = updateAuditOverrideSchema.safeParse({
    auditId: formData.get("auditId"),
    overallRatingOverride: formData.get("overallRatingOverride") || undefined,
    overallRatingOverrideNote: formData.get("overallRatingOverrideNote") || undefined,
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid rating override.");
  }
  const parsed = result.data;

  // The note textarea isn't tied to the select — a consultant can pick "No override" without
  // clearing leftover note text and hit the one Save button for both fields. Found live: that left
  // overallRatingOverrideNote populated while overallRatingOverride was null, so the audit page kept
  // showing old override reasoning text next to a "No override" dropdown (confusing, though harmless
  // to the actual report — renderHtml.ts's overrideBlock only renders when overallRatingOverride is
  // set). A note with no override is meaningless, so clearing the override always clears the note too.
  const overallRatingOverride = parsed.overallRatingOverride ?? null;
  const updated = await withOrgScope(orgId, async (tx) => {
    // update() throws the same raw PrismaClientKnownRequestError as findUniqueOrThrow when the row
    // is invisible under RLS (foreign-org auditId) — an explicit existence check first fails cleanly
    // instead, same fix shape as every other tamperable-id lookup in this file.
    const existing = await tx.audit.findUnique({ where: { id: parsed.auditId } });
    if (!existing) {
      throw new Error("Audit not found.");
    }
    return tx.audit.update({
      where: { id: parsed.auditId },
      data: {
        overallRatingOverride,
        overallRatingOverrideNote: overallRatingOverride ? (parsed.overallRatingOverrideNote ?? null) : null,
      },
    });
  });

  revalidatePath(`/engagements/${updated.engagementId}/audits/${updated.id}`);
}
