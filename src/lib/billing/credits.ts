import { CreditReason, type BillingPlan } from "@prisma/client";
import type { ScopedTx } from "@/lib/db/scoped";
import { includedAuditsPerYear, isEnforcementEnabled, isBillingConfigured } from "./config";
import { countSeats } from "./seats";

/**
 * The audit-credit ledger (spec.md §9 revised 2026-09-21: base plan includes N full audits per year,
 * overage batched onto the next monthly invoice — never charged per audit). Balance is always
 * computed from the append-only ledger, never cached on a column, so grants/consumption stay
 * auditable. All functions run inside a caller-provided withOrgScope transaction — RLS scopes every
 * row exactly like the rest of the tenant data.
 */
export async function getCreditBalance(tx: ScopedTx, orgId: string): Promise<number> {
  const result = await tx.auditCreditEntry.aggregate({ where: { orgId }, _sum: { delta: true } });
  return result._sum.delta ?? 0;
}

/**
 * Grants a plan's yearly included credits, idempotently per billing year: skips if a PLAN_GRANT was
 * already recorded in the last 350 days. Called from the Stripe webhook on subscription creation and
 * on each subsequent invoice.paid cycle — the 350-day window makes annual cycles grant every cycle
 * and monthly cycles grant only on the anniversary one, with no extra cycle-counting state.
 */
export async function grantPlanCreditsIfDue(tx: ScopedTx, orgId: string, plan: BillingPlan): Promise<boolean> {
  // Same advisory lock as consumeCreditForAudit — checkout.session.completed and the first
  // invoice.paid (and webhook retries) can arrive near-simultaneously; without this both read "no
  // recent grant" under read-committed and double-grant. The lock serializes them; the second sees
  // the first's committed grant and no-ops.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credits:${orgId}`}))`;

  const cutoff = new Date(Date.now() - 350 * 86_400_000);
  // Plan-aware idempotency: the guard matches a prior grant FOR THE SAME PLAN, so repeated webhooks
  // for one plan never double-grant, but a mid-cycle Solo→Team change is NOT suppressed — it grants
  // the new plan's full bundle on top of the old (Solo 3 + Team 6 = 9 for the year, not a prorated
  // difference). That over-grant is deliberate: upgrades are rare, customer-favorable, and fully
  // visible in the ledger; prorating credits would be more surprising than generous. The note
  // carries the plan so this query can find same-plan grants.
  const planNote = `${plan} yearly included audits`;
  // startsWith, not equality: the note records the seat count the grant was sized for (below), and
  // a firm that adds a seat mid-year must NOT look like a different plan and get a second grant.
  // Idempotency stays keyed on the plan alone; the seat count is recorded for auditability only.
  const recentGrant = await tx.auditCreditEntry.findFirst({
    where: {
      orgId,
      reason: CreditReason.PLAN_GRANT,
      note: { startsWith: planNote },
      createdAt: { gt: cutoff },
    },
  });
  if (recentGrant) return false;

  // spec.md §9 gives the Team tier included audits that "scale with seats", so the bundle is sized
  // at grant time from the org's current seat count. Deliberately a snapshot, not a running
  // entitlement: seats added later in the year do not retroactively grant more credits, and seats
  // removed do not claw any back. Anything else would mean recomputing a year's entitlement on
  // every membership change, and the ledger is append-only precisely so balances are explainable.
  const seats = await countSeats(tx, orgId);
  const credits = includedAuditsPerYear(plan, seats);
  if (credits <= 0) return false;
  await tx.auditCreditEntry.create({
    data: {
      orgId,
      delta: credits,
      reason: CreditReason.PLAN_GRANT,
      note: `${planNote} (${seats} seat${seats === 1 ? "" : "s"})`,
    },
  });
  return true;
}

export type ConsumeResult =
  | { outcome: "not-configured" } // billing off entirely — nothing recorded
  | { outcome: "consumed" } // a credit was spent
  | { outcome: "overage"; billable: boolean } // no balance — recorded; billable when a subscription is active
  | { outcome: "blocked"; reason: string }; // enforcement on, no balance, no active subscription

/**
 * Records the credit consequence of creating one full Audit (Tier A alone is never metered —
 * spec.md §9 — and Tier A runs happen inside an Audit, so the metered unit is Audit creation).
 *
 * MUST be called inside the same withOrgScope transaction that creates the Audit: it takes a
 * per-org advisory lock (same aggregate-race shape as team.ts's last-owner check) so two concurrent
 * creations can't both read balance=1 and both consume it, and "blocked" aborts the Audit's own
 * transaction with it.
 *
 * With enforcement off (the launch-gate default), consumption/overage is recorded for measurement
 * but nothing is ever blocked and nothing is marked billable.
 */
export async function consumeCreditForAudit(
  tx: ScopedTx,
  orgId: string,
  auditId: string,
): Promise<ConsumeResult> {
  if (!isBillingConfigured()) return { outcome: "not-configured" };

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credits:${orgId}`}))`;

  const balance = await getCreditBalance(tx, orgId);
  if (balance > 0) {
    await tx.auditCreditEntry.create({
      data: { orgId, delta: -1, reason: CreditReason.AUDIT_CONSUMED, auditId },
    });
    return { outcome: "consumed" };
  }

  const account = await tx.billingAccount.findUnique({ where: { orgId } });
  const hasActiveSubscription = account?.status === "ACTIVE";

  if (isEnforcementEnabled() && !hasActiveSubscription) {
    return {
      outcome: "blocked",
      // Names WHO can resolve this rather than instructing the reader to do it. Choosing a plan is
      // an owner-only action, so telling a teammate to "choose a plan on the Settings page" sends
      // them to a control they cannot use and makes a billing limit look like a permissions bug
      // they have done something wrong to hit. This wording reads correctly to an owner too, and
      // needs no role passed down into the ledger to get right.
      reason:
        "This account has no audit credits remaining and no active subscription. The account owner " +
        "can choose a plan on the Settings page to run full audits.",
    };
  }

  // Overage: delta 0 (the ledger records the event without driving the balance further negative —
  // each overage is billed, not borrowed against). Billable only when there's a subscription to
  // attach the invoice item to AND enforcement is live.
  const billable = isEnforcementEnabled() && hasActiveSubscription;
  await tx.auditCreditEntry.create({
    data: {
      orgId,
      delta: 0,
      reason: CreditReason.OVERAGE,
      auditId,
      note: billable ? "billable — invoice item on next rollup" : "recorded only (enforcement off)",
    },
  });
  return { outcome: "overage", billable };
}
