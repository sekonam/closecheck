/**
 * One-off verification (not part of the app) for the audit-credit ledger (docs/spec.md §9,
 * src/lib/billing/credits.ts) — the Phase 2.5 billing logic that can't be exercised through real
 * Stripe checkout without live keys. Runs the actual grant/consume functions against a throwaway
 * org through withOrgScope (real RLS), asserting: plan grant, same-plan idempotency, upgrade
 * top-up, credit consumption, and the enforcement on/off block/overage split.
 *
 * Sets STRIPE_SECRET_KEY/WEBHOOK_SECRET to dummy values in-process so isBillingConfigured() is true
 * (the functions gate on configuration, not on reaching Stripe — no network call happens here).
 *
 * Run with: npx tsx -r dotenv/config scripts/verify-billing-credits.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, BillingPlan, BillingStatus } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { getCreditBalance, grantPlanCreditsIfDue, consumeCreditForAudit } from "@/lib/billing/credits";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET ||= "whsec_dummy";
process.env.BILLING_INCLUDED_AUDITS_MONTHLY = "3";
process.env.BILLING_INCLUDED_AUDITS_ANNUAL = "6";

const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

let ok = true;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) ok = false;
}

async function main() {
  const orgId = `verify-billing-${randomUUID()}`;
  await directPrisma.consultantOrg.create({ data: { id: orgId, name: "Verify Billing Org" } });

  try {
    // --- Plan grant + same-plan idempotency
    await withOrgScope(orgId, async (tx) => {
      const granted = await grantPlanCreditsIfDue(tx, orgId, BillingPlan.SOLO_MONTHLY);
      check("first SOLO_MONTHLY grant returns true", granted === true);
      check("balance is 3 after grant", (await getCreditBalance(tx, orgId)) === 3);

      const again = await grantPlanCreditsIfDue(tx, orgId, BillingPlan.SOLO_MONTHLY);
      check("repeat same-plan grant is a no-op (idempotent renewal/retry)", again === false);
      check("balance still 3 after repeat", (await getCreditBalance(tx, orgId)) === 3);
    });

    // --- Upgrade tops up with the new plan's full bundle (deliberate, per credits.ts)
    await withOrgScope(orgId, async (tx) => {
      const upgraded = await grantPlanCreditsIfDue(tx, orgId, BillingPlan.TEAM_ANNUAL);
      check("mid-cycle upgrade to TEAM_ANNUAL grants", upgraded === true);
      check("balance is 3 + 6 = 9 after upgrade", (await getCreditBalance(tx, orgId)) === 9);
    });

    // --- Consumption spends one credit per audit
    await withOrgScope(orgId, async (tx) => {
      const r = await consumeCreditForAudit(tx, orgId, randomUUID());
      check("consume with balance returns 'consumed'", r.outcome === "consumed");
      check("balance is 8 after one consume", (await getCreditBalance(tx, orgId)) === 8);
    });

    // --- Drain to zero, then test enforcement OFF → overage recorded, not blocked
    await withOrgScope(orgId, async (tx) => {
      for (let i = 0; i < 8; i++) await consumeCreditForAudit(tx, orgId, randomUUID());
      check("balance is 0 after draining", (await getCreditBalance(tx, orgId)) === 0);
    });
    process.env.BILLING_ENFORCEMENT = "false";
    await withOrgScope(orgId, async (tx) => {
      const r = await consumeCreditForAudit(tx, orgId, randomUUID());
      check("enforcement off: zero-balance consume is 'overage', not blocked", r.outcome === "overage");
      check("enforcement off: overage is not billable", r.outcome === "overage" && r.billable === false);
    });

    // --- Enforcement ON, no active subscription → blocked
    process.env.BILLING_ENFORCEMENT = "true";
    await withOrgScope(orgId, async (tx) => {
      const r = await consumeCreditForAudit(tx, orgId, randomUUID());
      check("enforcement on + no subscription: consume is 'blocked'", r.outcome === "blocked");
    });

    // --- Enforcement ON, active subscription → billable overage
    await withOrgScope(orgId, (tx) =>
      tx.billingAccount.create({
        data: {
          orgId,
          stripeCustomerId: `cus_verify_${randomUUID()}`,
          stripeSubscriptionId: `sub_verify_${randomUUID()}`,
          plan: BillingPlan.TEAM_ANNUAL,
          status: BillingStatus.ACTIVE,
        },
      }),
    );
    await withOrgScope(orgId, async (tx) => {
      const r = await consumeCreditForAudit(tx, orgId, randomUUID());
      check("enforcement on + active subscription: billable overage", r.outcome === "overage" && r.billable === true);
    });

    console.log(ok ? "\nRESULT: PASS — credit ledger behaves correctly across grant/consume/overage/block." : "\nRESULT: FAIL");
    if (!ok) process.exitCode = 1;
  } finally {
    await directPrisma.consultantOrg.delete({ where: { id: orgId } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => directPrisma.$disconnect());
