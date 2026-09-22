"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { BillingPlan } from "@prisma/client";
import { withOrgScope, type ScopedTx } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getStripe } from "@/lib/billing/stripe";
import { basePriceIdForPlan, isBillingConfigured, isTeam, seatPriceIdForPlan } from "@/lib/billing/config";
import { billableSeatQuantity, countSeats } from "@/lib/billing/seats";
import { recordError } from "@/lib/metrics/record";

/** Owner-only, same reasoning as API keys/webhooks: plan changes bind the org to charges. */
async function requireOwner(tx: ScopedTx, userId: string): Promise<void> {
  const caller = await tx.user.findUnique({ where: { id: userId } });
  if (!caller) {
    throw new Error("Your account could not be found.");
  }
  if (caller.role !== "OWNER") {
    throw new Error("Only the account owner can manage billing.");
  }
}

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}

/**
 * Ensures the org has a BillingAccount + Stripe customer, creating both on first use. The customer
 * carries `metadata.orgId` — the ONLY org linkage the webhook handler trusts (signature-verified,
 * server-set here, never client input), which is what lets billing avoid a cross-org DB role
 * entirely: every webhook resolves metadata → orgId → withOrgScope.
 */
async function ensureBillingAccount(orgId: string, orgName: string, email: string): Promise<string> {
  const existing = await withOrgScope(orgId, (tx) => tx.billingAccount.findUnique({ where: { orgId } }));
  if (existing) return existing.stripeCustomerId;

  const stripe = getStripe();
  if (!stripe) throw new Error("Billing is not configured.");
  const customer = await stripe.customers.create({
    name: orgName,
    email,
    metadata: { orgId },
  });

  try {
    await withOrgScope(orgId, (tx) =>
      tx.billingAccount.create({ data: { orgId, stripeCustomerId: customer.id } }),
    );
    return customer.id;
  } catch (err) {
    // A concurrent call (double-clicked plan button) won the orgId-unique row first — this Stripe
    // customer is now an orphan carrying metadata.orgId that a future webhook could resolve against.
    // Delete it and use the winner's customer id, so exactly one customer exists per org.
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      // A failed delete would strand a metadata.orgId-bearing customer a future webhook could resolve
      // against — record it so it's traceable/cleanable rather than silently orphaned.
      await stripe.customers
        .del(customer.id)
        .catch((delErr) =>
          recordError("billing-orphan-customer", delErr instanceof Error ? delErr : new Error(String(delErr)), {
            orgId,
          }),
        );
      const winner = await withOrgScope(orgId, (tx) => tx.billingAccount.findUniqueOrThrow({ where: { orgId } }));
      return winner.stripeCustomerId;
    }
    throw err;
  }
}

const startCheckoutSchema = z.nativeEnum(BillingPlan);

export async function startCheckout(formData: FormData): Promise<void> {
  const { orgId, userId, email } = await requireOrgSession();
  if (!isBillingConfigured()) {
    throw new Error("Billing is not configured on this deployment yet.");
  }

  const parsed = startCheckoutSchema.safeParse(formData.get("plan"));
  if (!parsed.success) {
    throw new Error("Unknown plan.");
  }
  const plan = parsed.data;
  const basePriceId = basePriceIdForPlan(plan);
  if (!basePriceId) {
    throw new Error(`No Stripe price configured for ${plan} — set the matching STRIPE_PRICE_* env var.`);
  }
  const seatPriceId = seatPriceIdForPlan(plan);
  if (isTeam(plan) && !seatPriceId) {
    throw new Error(`No per-seat Stripe price configured for ${plan} — set the matching STRIPE_PRICE_TEAM_* env var.`);
  }

  const { orgName, seats } = await withOrgScope(orgId, async (tx) => {
    await requireOwner(tx, userId);
    // Refuse a second checkout when a subscription already exists and isn't fully canceled — Stripe
    // does not dedupe, so a PAST_DUE org completing checkout again would end up with two live
    // subscriptions on one customer. Such an org belongs in the billing portal (to pay/update),
    // reached via openBillingPortal, not a fresh checkout.
    const account = await tx.billingAccount.findUnique({ where: { orgId } });
    if (account?.stripeSubscriptionId && account.status !== "CANCELED") {
      throw new Error(
        "This account already has a subscription. Use “Manage subscription & invoices” to change or update it.",
      );
    }
    const org = await tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });
    return { orgName: org.name, seats: await countSeats(tx, orgId) };
  });

  const customerId = await ensureBillingAccount(orgId, orgName, email);
  const stripe = getStripe();
  if (!stripe) throw new Error("Billing is not configured.");

  // A Team subscription is the base subscription plus one per-seat line for every seat beyond the
  // first (spec.md §9, and see basePriceIdForPlan's comment). The seat line is omitted entirely
  // rather than sent with quantity 0, which Stripe Checkout rejects — syncSeatQuantity adds it the
  // moment a second teammate is invited.
  const lineItems: { price: string; quantity: number }[] = [{ price: basePriceId, quantity: 1 }];
  const seatQuantity = billableSeatQuantity(seats);
  if (seatPriceId && seatQuantity > 0) {
    lineItems.push({ price: seatPriceId, quantity: seatQuantity });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    // The plan is recorded explicitly rather than left to be inferred from the price lines.
    // Inference cannot distinguish a one-person Team subscription from a Solo one: a Team org with
    // a single member has no seat line at all (there are seats-1 of them), so the subscription
    // carries only the shared base price and looked exactly like Solo. That mislabelled the org,
    // sized its credit bundle wrongly, and — with enforcement on — dead-ended it: the seat cap
    // refused the first invite and told them to switch to a Team plan, while startCheckout refused
    // that because a subscription already existed. Metadata is server-set and signature-verified on
    // the way back, exactly like orgId.
    subscription_data: { metadata: { orgId, plan } },
    metadata: { orgId },
    success_url: appUrl("/settings?billing=success"),
    cancel_url: appUrl("/settings?billing=canceled"),
  });
  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  redirect(session.url);
}

export async function openBillingPortal(): Promise<void> {
  const { orgId, userId } = await requireOrgSession();
  if (!isBillingConfigured()) {
    throw new Error("Billing is not configured on this deployment yet.");
  }

  const account = await withOrgScope(orgId, async (tx) => {
    await requireOwner(tx, userId);
    return tx.billingAccount.findUnique({ where: { orgId } });
  });
  if (!account) {
    throw new Error("No billing account yet — choose a plan first.");
  }

  const stripe = getStripe();
  if (!stripe) throw new Error("Billing is not configured.");
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: appUrl("/settings"),
  });
  redirect(session.url);
}
