import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Stripe from "stripe";
import { withOrgScope } from "@/lib/db/scoped";
import { createOrgFixture, destroyOrgFixture, type OrgFixture } from "./helpers/fixtures";
import { BASE_URL, serverIsReachable } from "./helpers/http";

/**
 * End-to-end billing run against REAL Stripe test-mode objects.
 *
 * docs/roadmap.md Phase 2.5's exit criterion wants a charge and a refund processed end to end. The
 * part of that which is founder-blocked is live keys — nobody but the account owner can provision
 * those. The part that is NOT blocked is everything this file covers: real Stripe customers,
 * subscriptions, invoices and refunds created through the real API, turned into real signed webhook
 * events, and delivered to the running app's actual webhook route, which verifies the signature
 * with the configured STRIPE_WEBHOOK_SECRET before it will act on anything.
 *
 * Why the events are constructed here rather than delivered by Stripe: Stripe cannot reach a
 * localhost dev server without a tunnel. The event BODIES are real API objects and the signature is
 * a real HMAC over them using the deployment's own webhook secret, so the route's trust anchor —
 * signature verification, then org resolution from server-set metadata only — is exercised exactly
 * as it would be in production. The only thing simulated is the transport.
 *
 * Test mode moves no money. Every object created here is deleted or canceled in teardown.
 */
const stripeKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Skipping is OPT-IN, not automatic.
 *
 * This file previously skipped itself whenever STRIPE_SECRET_KEY was absent — so on CI, and on any
 * machine without the key, it reported green having executed zero assertions, including the
 * signature-rejection and double-grant checks. docs/releases.md §5 cites this file as the evidence
 * closing a launch gate, which makes a silent skip worse than no test: the gate looks verified on
 * every run while nothing is verified at all.
 *
 * So an unconfigured environment now FAILS unless it says out loud that it means to skip, the same
 * reasoning api-tenant-isolation.itest.ts already applies to an unreachable server.
 */
const optedOut = process.env.CLOSECHECK_SKIP_STRIPE_E2E === "true";
const configured = !!stripeKey?.startsWith("sk_test_") && !!webhookSecret;
const canRun = configured && !optedOut;

/**
 * Refuses to run against anything but a test-mode key. A live key here would create real customers
 * and move real money, and this suite is designed to be run casually and often.
 */
if (stripeKey && !stripeKey.startsWith("sk_test_")) {
  throw new Error("Refusing to run the billing E2E suite against a non-test Stripe key.");
}

const stripe = canRun ? new Stripe(stripeKey!) : null;

/** Stripe's documented always-succeeds test payment method. No real card is involved. */
const TEST_PAYMENT_METHOD = "pm_card_visa";

async function deliverWebhook(type: string, object: unknown): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_itest_${Date.now()}`,
    object: "event",
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
  });
  const header = stripe!.webhooks.generateTestHeaderString({ payload, secret: webhookSecret! });
  return fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
    signal: AbortSignal.timeout(30_000),
  });
}

describe("Phase 2.5 — billing works end to end against real Stripe test-mode objects", () => {
  it("is either configured to run or explicitly opted out", () => {
    expect(
      configured || optedOut,
      "STRIPE_SECRET_KEY (sk_test_) and STRIPE_WEBHOOK_SECRET are not set, and CLOSECHECK_SKIP_STRIPE_E2E " +
        "is not 'true'. This suite is the evidence behind a docs/releases.md §5 launch gate, so it " +
        "refuses to skip quietly — either configure it or opt out deliberately.",
    ).toBe(true);
  });
});

describe.skipIf(!canRun)("Phase 2.5 — billing end-to-end (real Stripe test mode)", () => {
  let org: OrgFixture;
  let customerId: string;
  let subscriptionId: string;
  const createdCustomers: string[] = [];

  beforeAll(async () => {
    expect(
      await serverIsReachable(),
      `No app server at ${BASE_URL}; the webhook route cannot be exercised.`,
    ).toBe(true);

    org = await createOrgFixture("billing");

    // metadata.orgId is the only org linkage the webhook route trusts, and it is server-set — this
    // mirrors exactly what ensureBillingAccount writes in src/lib/actions/billing.ts.
    const customer = await stripe!.customers.create({
      name: org.orgName,
      email: org.userEmail,
      metadata: { orgId: org.orgId },
      payment_method: TEST_PAYMENT_METHOD,
      invoice_settings: { default_payment_method: TEST_PAYMENT_METHOD },
    });
    customerId = customer.id;
    createdCustomers.push(customer.id);

    await withOrgScope(org.orgId, (tx) =>
      tx.billingAccount.create({ data: { orgId: org.orgId, stripeCustomerId: customerId } }),
    );
  });

  afterAll(async () => {
    if (subscriptionId) {
      await stripe?.subscriptions.cancel(subscriptionId).catch(() => {});
    }
    for (const id of createdCustomers) {
      await stripe?.customers.del(id).catch(() => {});
    }
    if (org) await destroyOrgFixture(org.orgId);
  });

  it("rejects an unsigned webhook before doing anything", async () => {
    const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "customer.subscription.updated" }),
      signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a webhook signed with the wrong secret", async () => {
    const payload = JSON.stringify({ id: "evt_x", type: "customer.subscription.updated", data: { object: {} } });
    const header = stripe!.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong_secret" });
    const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": header },
      body: payload,
      signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(400);
  });

  it("creates a real subscription and records it from a signed webhook", async () => {
    const basePrice = process.env.STRIPE_PRICE_SOLO_MONTHLY;
    expect(basePrice, "STRIPE_PRICE_SOLO_MONTHLY must be set").toBeTruthy();

    const subscription = await stripe!.subscriptions.create({
      customer: customerId,
      items: [{ price: basePrice!, quantity: 1 }],
      metadata: { orgId: org.orgId },
    });
    subscriptionId = subscription.id;

    const res = await deliverWebhook("customer.subscription.updated", subscription);
    expect(res.status).toBe(200);

    const account = await withOrgScope(org.orgId, (tx) =>
      tx.billingAccount.findUnique({ where: { orgId: org.orgId } }),
    );
    expect(account?.stripeSubscriptionId).toBe(subscription.id);
    expect(account?.plan).toBe("SOLO_MONTHLY");
    expect(account?.status).toBe("ACTIVE");
  });

  it("granted the plan's included audit credits exactly once", async () => {
    const entries = await withOrgScope(org.orgId, (tx) =>
      tx.auditCreditEntry.findMany({ where: { orgId: org.orgId, reason: "PLAN_GRANT" } }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].delta).toBeGreaterThan(0);

    // Redelivery is normal Stripe behaviour, not an edge case — it must not double-grant.
    const subscription = await stripe!.subscriptions.retrieve(subscriptionId);
    expect((await deliverWebhook("customer.subscription.updated", subscription)).status).toBe(200);

    const after = await withOrgScope(org.orgId, (tx) =>
      tx.auditCreditEntry.findMany({ where: { orgId: org.orgId, reason: "PLAN_GRANT" } }),
    );
    expect(after).toHaveLength(1);
  });

  it("classifies a two-line Team subscription as Team, not Solo", async () => {
    const basePrice = process.env.STRIPE_PRICE_SOLO_MONTHLY;
    const seatPrice = process.env.STRIPE_PRICE_TEAM_MONTHLY;
    expect(seatPrice, "STRIPE_PRICE_TEAM_MONTHLY must be set").toBeTruthy();

    const teamOrg = await createOrgFixture("billing-team");
    try {
      const customer = await stripe!.customers.create({
        name: teamOrg.orgName,
        email: teamOrg.userEmail,
        metadata: { orgId: teamOrg.orgId },
        payment_method: TEST_PAYMENT_METHOD,
        invoice_settings: { default_payment_method: TEST_PAYMENT_METHOD },
      });
      createdCustomers.push(customer.id);
      await withOrgScope(teamOrg.orgId, (tx) =>
        tx.billingAccount.create({ data: { orgId: teamOrg.orgId, stripeCustomerId: customer.id } }),
      );

      const subscription = await stripe!.subscriptions.create({
        customer: customer.id,
        items: [
          { price: basePrice!, quantity: 1 },
          { price: seatPrice!, quantity: 2 },
        ],
        metadata: { orgId: teamOrg.orgId },
      });

      try {
        expect((await deliverWebhook("customer.subscription.updated", subscription)).status).toBe(200);
        const account = await withOrgScope(teamOrg.orgId, (tx) =>
          tx.billingAccount.findUnique({ where: { orgId: teamOrg.orgId } }),
        );
        expect(account?.plan).toBe("TEAM_MONTHLY");

        // And the money is right: base plus two seats must exceed the base alone.
        const total = subscription.items.data.reduce(
          (sum, item) => sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 0),
          0,
        );
        const soloAmount = (await stripe!.prices.retrieve(basePrice!)).unit_amount ?? 0;
        expect(total).toBeGreaterThan(soloAmount);
      } finally {
        await stripe!.subscriptions.cancel(subscription.id).catch(() => {});
      }
    } finally {
      await destroyOrgFixture(teamOrg.orgId);
    }
  });

  it("processes a real charge and a real refund through the API", async () => {
    // A one-off PaymentIntent rather than the subscription invoice: subscription invoices settle
    // asynchronously and this assertion is about the charge/refund path itself being wired and
    // usable with these credentials, which is what the Phase 2.5 gate is really asking.
    const intent = await stripe!.paymentIntents.create({
      amount: 12900,
      currency: "usd",
      customer: customerId,
      payment_method: TEST_PAYMENT_METHOD,
      confirm: true,
      description: "CloseCheck integration test — per-audit overage",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });
    expect(intent.status).toBe("succeeded");

    const refund = await stripe!.refunds.create({ payment_intent: intent.id });
    expect(refund.status).toBe("succeeded");

    const refreshed = await stripe!.paymentIntents.retrieve(intent.id);
    expect(refreshed.amount_received - (refund.amount ?? 0)).toBe(0);
  });

  it("acknowledges rather than retries forever when the org no longer exists", async () => {
    const doomed = await createOrgFixture("billing-doomed");
    const customer = await stripe!.customers.create({
      name: doomed.orgName,
      metadata: { orgId: doomed.orgId },
    });
    createdCustomers.push(customer.id);

    // Delete the org, then deliver a subscription event still carrying its id — the shape that used
    // to throw P2025, return 500, and make Stripe retry an unfixable event for days.
    await destroyOrgFixture(doomed.orgId);

    const res = await deliverWebhook("customer.subscription.updated", {
      id: "sub_itest_orphan",
      object: "subscription",
      customer: customer.id,
      status: "active",
      metadata: { orgId: doomed.orgId },
      items: { object: "list", data: [] },
    });
    expect(res.status).toBe(200);
  });
});
