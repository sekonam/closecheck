"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuditStatus, FindingStatus, Severity, type Prisma } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { isAutomatable, runTierACheck } from "@/lib/audit/tierA";
import { assertPublicHost } from "@/lib/net/hostSafety";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { consumeCreditForAudit } from "@/lib/billing/credits";
import { getStripe } from "@/lib/billing/stripe";
import { overagePriceId } from "@/lib/billing/config";
import { recordMetric, recordError } from "@/lib/metrics/record";
import { parseFieldSchema, readFieldValues } from "@/lib/templates/fieldSchema";
import { isWorthRemembering, vendorKeyFor, vendorLabelFor } from "@/lib/audit/vendorMemory";

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

  const { audit, consume } = await withOrgScope(orgId, async (tx) => {
    // Confirm the engagement belongs to this org before creating anything under it — withOrgScope's
    // RLS policy would reject a cross-org write anyway, but failing with a clear error here beats a
    // raw crash surfacing to a user. findUnique, not findUniqueOrThrow: a foreign-org engagementId
    // resolves to zero rows under RLS (not a Postgres error), and findUniqueOrThrow's raw
    // PrismaClientKnownRequestError (P2025) would still crash to Next's default 500 page otherwise.
    const engagement = await tx.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement) {
      throw new Error("Engagement not found.");
    }

    const created = await tx.audit.create({
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

    // Credit consequence in the SAME transaction (spec.md §9: a full Audit is the metered unit;
    // Tier A alone is never metered) — "blocked" throws here, so the Audit row above rolls back
    // with it and enforcement can't be raced past by committing first.
    const consumeResult = await consumeCreditForAudit(tx, orgId, created.id);
    if (consumeResult.outcome === "blocked") {
      throw new Error(consumeResult.reason);
    }
    return { audit: created, consume: consumeResult };
  });

  // Billable overage becomes a Stripe invoice item AFTER commit (external API call, never inside a
  // DB transaction) — Stripe sweeps pending invoice items into the subscription's next monthly
  // invoice, which is exactly the batched-rollup billing the roadmap specifies (never per-audit
  // charges). Best-effort: a failure here loses one overage line item, not the audit.
  if (consume.outcome === "overage" && consume.billable) {
    void recordOverageInvoiceItem(orgId, audit.id).catch((err) => {
      // Billable revenue — a lost invoice item must be recoverable, not silently dropped. The
      // OVERAGE ledger row already exists (note: "invoice item on next rollup"); this error_events
      // row is how a reconciliation job or the founder finds the ones that never reached Stripe.
      void recordError("billing-overage", err instanceof Error ? err : new Error(String(err)), { orgId });
    });
  }

  void recordMetric("audit.created", { orgId, data: { auditId: audit.id, templateId: template.id } });

  revalidatePath(`/engagements/${engagementId}`);
  redirect(`/engagements/${engagementId}/audits/${audit.id}`);
}

/** Attaches one overage invoice item to the org's Stripe customer (batched onto the next rollup
 * invoice by Stripe). Module-private: only createAudit's post-commit hook calls it. */
async function recordOverageInvoiceItem(orgId: string, auditId: string): Promise<void> {
  const stripe = getStripe();
  const priceId = overagePriceId();
  if (!stripe || !priceId) return;
  const account = await withOrgScope(orgId, (tx) => tx.billingAccount.findUnique({ where: { orgId } }));
  if (!account) return;
  await stripe.invoiceItems.create({
    customer: account.stripeCustomerId,
    pricing: { price: priceId },
    description: `Audit overage (audit ${auditId})`,
  });
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

  // Second safety layer, immediately before anything connects. `validatePrimaryDomain` already
  // refused non-public literals when the domain was stored, but that check is name-based, and a
  // name can point anywhere: `evil.com` resolving to 169.254.169.254 satisfies every syntactic
  // rule. Resolving here and refusing a domain whose addresses aren't public closes that, and it
  // matters more for Tier A than for webhook delivery because these responses — redirect chains,
  // headers, CMS fingerprints, certificate subjects — get written into a Finding the user reads
  // back. See src/lib/net/hostSafety.ts on what this does and does not defend against; it is not
  // a rebinding defence.
  const hostVerdict = await assertPublicHost(domain);
  if (!hostVerdict.safe) {
    throw new Error(`Tier A checks were not run: ${hostVerdict.reason}.`);
  }

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
});

export async function updateFinding(formData: FormData) {
  const { orgId } = await requireOrgSession();
  const result = updateFindingSchema.safeParse({
    findingId: formData.get("findingId"),
    status: formData.get("status"),
    severity: formData.get("severity") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid finding update.");
  }
  const parsed = result.data;

  // A not-applicable finding carries no severity. Both fields live on the same form, so rating an
  // item Red and later switching its status to NOT APPLICABLE (having learned the business has no
  // such system) left the stale Red persisted — and the roll-up excludes not-applicable findings
  // from both severity and coverage, so the report showed that row as Red underneath a tier header
  // reading Green. A visible self-contradiction in the document handed to the buyer. Normalising
  // here means the two can never be stored together in the first place.
  const severity = parsed.status === FindingStatus.NOT_APPLICABLE ? null : (parsed.severity ?? null);

  // spec.md §4's severity model: "Red items require a note, Yellow items recommend one, Green
  // items don't need one." Enforced here rather than only in the UI because this is a claim that
  // ends up in a client deliverable — an unexplained Red is the one finding a buyer will push back
  // on hardest, and the consultant has to be able to answer. Yellow stays a recommendation, per
  // the spec; the audit page nudges for it without blocking.
  if (severity === Severity.RED && !parsed.note?.trim()) {
    throw new Error("A Red finding needs a note explaining it — spec §4 requires one.");
  }

  const updated = await withOrgScope(orgId, async (tx) => {
    // findUnique, not findUniqueOrThrow: a findingId for another org resolves to zero rows under
    // RLS (not a Postgres policy error, just an empty result), so findUniqueOrThrow's raw
    // PrismaClientKnownRequestError (P2025) would crash to Next's default 500 page instead of a
    // clean message — found live via cross-tenant IDOR testing with a real foreign findingId.
    const existing = await tx.finding.findUnique({
      where: { id: parsed.findingId },
      include: { templateItem: true, audit: { include: { engagement: true } } },
    });
    if (!existing) {
      throw new Error("Finding not found.");
    }

    // Whether this submit may touch structuredData is decided from the finding's own pinned
    // TemplateItem — never from whether the posted values happen to be non-empty. Gating on
    // posted-value truthiness meant a consultant clearing every field back to blank (a legitimate
    // correction) silently left stale structuredData in place, since an all-empty submission looks
    // identical to "this form doesn't carry these fields." Reading the item's declared schema also
    // means a crafted submission cannot write fields onto an item that doesn't declare them: the
    // schema is the allowlist, checked server-side against the row, not against the form.
    //
    // MANUAL only. structuredData does double duty as the Tier A automated runner's output store
    // (see runTierAChecks above), and an automated item's check output must never be clobbered by
    // a form submission. Template content is asserted to never declare a fieldSchema on an
    // AUTOMATED item (src/lib/templates/content.ts); this is the runtime half of that invariant.
    const schema =
      existing.templateItem.method === "MANUAL"
        ? parseFieldSchema(existing.templateItem.fieldSchema)
        : null;

    let structuredUpdate: { structuredData: Prisma.InputJsonValue } | Record<string, never> = {};
    if (schema) {
      // Materialise the submitted fields once. FormData.get is a linear scan of the entry list,
      // and readFieldValues probes a bounded but non-trivial number of names (up to 16 fields plus
      // 200 table rows x 8 columns), so a crafted submission padded with junk entries would make
      // each probe walk the whole list. One pass to build the map keeps it linear overall.
      const submitted = new Map<string, string>();
      for (const [name, value] of formData.entries()) {
        if (typeof value === "string" && !submitted.has(name)) submitted.set(name, value);
      }
      const values = readFieldValues(schema, (name) => submitted.get(name) ?? null);
      if (!values.ok) {
        throw new Error(
          values.errors.map((error) => `${error.label} ${error.message}`).join("; "),
        );
      }
      structuredUpdate = { structuredData: values.values as Prisma.InputJsonValue };

      // Remember what this firm recorded about this vendor, for the next deal (see
      // src/lib/audit/vendorMemory.ts — reference only, never prefilled). Written in the same
      // transaction as the finding so the memory can never claim something the audit does not say.
      if (isWorthRemembering(schema, values.values)) {
        const vendorLabel = vendorLabelFor(schema, values.values)!;
        const profile = {
          orgId,
          itemTitle: existing.templateItem.title,
          vendorKey: vendorKeyFor(vendorLabel),
          vendorLabel,
          values: values.values as Prisma.InputJsonValue,
          engagementId: existing.audit.engagementId,
          sourceBusinessName: existing.audit.engagement.businessName,
        };
        await tx.vendorTermProfile.upsert({
          where: {
            orgId_itemTitle_vendorKey_engagementId: {
              orgId,
              itemTitle: profile.itemTitle,
              vendorKey: profile.vendorKey,
              engagementId: profile.engagementId,
            },
          },
          create: profile,
          update: {
            vendorLabel: profile.vendorLabel,
            values: profile.values,
            sourceBusinessName: profile.sourceBusinessName,
          },
        });
      }
    }

    return tx.finding.update({
      where: { id: parsed.findingId },
      data: {
        status: parsed.status,
        severity,
        note: parsed.note ?? null,
        // Omitting the key entirely (rather than writing null/{}) leaves Tier A's automated check
        // output untouched on findings this form has no structured fields for, since the same
        // action is shared by every finding's form regardless of tier or method.
        ...structuredUpdate,
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

/**
 * Marks an Audit COMPLETE. AuditStatus.COMPLETE existed in the schema from day one but nothing set
 * it until Phase 4 — the webhook `audit.completed` event (docs/spec.md §13.3) needed a real
 * lifecycle moment to fire on, and "the consultant says the audit is done" is that moment. No
 * finding-state precondition is enforced: whether an audit with BLOCKED or NOT_STARTED items is
 * "done" is the consultant's professional judgment (coverage is already surfaced on the report
 * itself per §6), not a rule the product should hard-code.
 */
export async function markAuditComplete(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const result = z.string().min(1).safeParse(formData.get("auditId"));
  if (!result.success) {
    throw new Error("Missing or invalid auditId.");
  }

  const { audit: updated, transitioned } = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.audit.findUnique({ where: { id: result.data } });
    if (!existing) {
      throw new Error("Audit not found.");
    }
    if (existing.status === AuditStatus.COMPLETE) {
      return { audit: existing, transitioned: false }; // idempotent — no duplicate webhook below
    }
    const audit = await tx.audit.update({
      where: { id: existing.id },
      data: { status: AuditStatus.COMPLETE },
    });
    return { audit, transitioned: true };
  });

  if (transitioned) {
    // Deliberately not awaited: delivery is best-effort (spec.md §13.3) and must never delay the
    // consultant's own request. dispatchWebhookEvent catches everything internally.
    void dispatchWebhookEvent(orgId, {
      event: "audit.completed",
      data: { auditId: updated.id, engagementId: updated.engagementId, status: updated.status },
    });
    void recordMetric("audit.completed", { orgId, data: { auditId: updated.id } });
  }

  revalidatePath(`/engagements/${updated.engagementId}/audits/${updated.id}`);
}

/** The inverse of markAuditComplete — findings needing rework after completion is a normal deal
 * reality, not an error path. No webhook fires on reopen; receivers track completions, and a
 * re-completion after rework fires a fresh audit.completed. */
export async function reopenAudit(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const result = z.string().min(1).safeParse(formData.get("auditId"));
  if (!result.success) {
    throw new Error("Missing or invalid auditId.");
  }

  const updated = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.audit.findUnique({ where: { id: result.data } });
    if (!existing) {
      throw new Error("Audit not found.");
    }
    return tx.audit.update({
      where: { id: existing.id },
      data: { status: AuditStatus.IN_PROGRESS },
    });
  });

  revalidatePath(`/engagements/${updated.engagementId}/audits/${updated.id}`);
}
