import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { BillingStatus, type BillingPlan } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { getStripe } from "@/lib/billing/stripe";
import { planForPriceIds } from "@/lib/billing/config";
import { grantPlanCreditsIfDue } from "@/lib/billing/credits";
import { sendEmail } from "@/lib/email/send";
import { receipt } from "@/lib/email/templates";
import { recordError } from "@/lib/metrics/record";

/**
 * Stripe webhook receiver (docs/roadmap.md Phase 2.5). Public and unauthenticated by nature; the
 * trust anchor is the signature check against STRIPE_WEBHOOK_SECRET, after which the org is resolved
 * ONLY from server-set metadata (customer/subscription metadata.orgId written in
 * src/lib/actions/billing.ts) — never from any client-supplied value — and every DB write goes
 * through withOrgScope like the rest of the app. No cross-org DB role exists for billing.
 */
function mapStatus(stripeStatus: Stripe.Subscription.Status): BillingStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return BillingStatus.ACTIVE;
    case "past_due":
    case "unpaid":
    case "paused":
    // `incomplete` = a subscription whose first payment hasn't succeeded yet: it still EXISTS on the
    // customer, so it must NOT map to CANCELED — that would reopen the two-subscription hole
    // (startCheckout only refuses non-CANCELED). Treating it as PAST_DUE routes the org to the
    // billing portal to finish paying rather than letting it open a second subscription.
    case "incomplete":
      return BillingStatus.PAST_DUE;
    // `incomplete_expired` and `canceled` are genuinely gone — a fresh checkout is correct.
    default:
      return BillingStatus.CANCELED;
  }
}

/**
 * Reads the plan from EVERY line on the subscription, not just the first. A Team subscription
 * carries two items — the shared base price and the per-seat price (spec.md §9; see
 * basePriceIdForPlan in src/lib/billing/config.ts) — and Stripe does not guarantee item order, so
 * looking only at items.data[0] would classify a Team subscription as Solo roughly half the time.
 */
function planFromSubscription(subscription: Stripe.Subscription): BillingPlan | null {
  const priceIds = subscription.items.data
    .map((item) => item.price?.id)
    .filter((id): id is string => !!id);
  return planForPriceIds(priceIds);
}

async function orgIdFromCustomer(stripe: Stripe, customerId: string): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;
  return customer.metadata?.orgId || null;
}

/**
 * Applies a Stripe subscription's state to the org's BillingAccount.
 *
 * Upserts rather than updates. An update threw P2025 whenever no BillingAccount row existed for the
 * org, which the handler turned into a 500 and Stripe then retried forever with no path to succeed.
 * Two real ways to get there: a Stripe customer whose row insert failed after the customer was
 * created (ensureBillingAccount's non-P2002 path leaves exactly that orphan), and an org whose row
 * was deleted while its subscription was still live. The upsert makes the first self-heal on the
 * next webhook instead of wedging.
 *
 * Returns false when the org itself no longer exists — the row cannot be created against a missing
 * foreign key, and no future retry can change that. See the caller for why that answers 200.
 */
async function applySubscriptionState(orgId: string, subscription: Stripe.Subscription): Promise<boolean> {
  const plan = planFromSubscription(subscription);
  const status = mapStatus(subscription.status);
  const periodEnd = subscription.items.data[0]?.current_period_end;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

  return withOrgScope(orgId, async (tx) => {
    // RLS scopes this to the org resolved from signature-verified Stripe metadata; a deleted org
    // simply has no row to find, which is the unrecoverable case above.
    const org = await tx.consultantOrg.findUnique({ where: { id: orgId } });
    if (!org) return false;
    if (!customerId) return false;

    await tx.billingAccount.upsert({
      where: { orgId },
      create: {
        orgId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        plan: plan ?? undefined,
        status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      },
      update: {
        stripeSubscriptionId: subscription.id,
        plan: plan ?? undefined,
        status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      },
    });
    if (status === BillingStatus.ACTIVE && plan) {
      await grantPlanCreditsIfDue(tx, orgId, plan);
    }
    return true;
  });
}

/**
 * Stripe retries a 500 with backoff for days. That is right for a transient database failure and
 * wrong for an event that can never succeed — a subscription belonging to an org that no longer
 * exists will fail identically on every retry until Stripe gives up, while burning webhook
 * deliveries and hiding real failures in the dashboard's failed-delivery view. Such events are
 * recorded to error_events (where scripts/ops-error-triage.ts surfaces them for the founder) and
 * acknowledged, so the retry queue stays a signal about problems that are actually fixable.
 */
async function acknowledgeUnresolvable(eventType: string, orgId: string): Promise<void> {
  await recordError(
    "stripe-webhook-unresolvable",
    new Error(`${eventType}: org ${orgId} no longer exists; acknowledging instead of retrying forever`),
  );
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Billing not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const orgId = session.metadata?.orgId;
        if (orgId && typeof session.subscription === "string") {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          if (!(await applySubscriptionState(orgId, subscription))) {
            await acknowledgeUnresolvable(event.type, orgId);
          }
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const orgId = subscription.metadata?.orgId;
        if (orgId) {
          if (!(await applySubscriptionState(orgId, subscription))) {
            await acknowledgeUnresolvable(event.type, orgId);
          }
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (!customerId) break;
        const orgId = await orgIdFromCustomer(stripe, customerId);
        if (!orgId) break;

        await withOrgScope(orgId, async (tx) => {
          const account = await tx.billingAccount.findUnique({ where: { orgId } });
          if (account?.plan && account.status === BillingStatus.ACTIVE) {
            await grantPlanCreditsIfDue(tx, orgId, account.plan);
          }
        });

        // Receipt to the org's first owner — Phase 2.5's "receives every system email" exit
        // criterion. Best-effort: sendEmail never throws.
        const owner = await withOrgScope(orgId, (tx) =>
          tx.user.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } }),
        );
        const org = await withOrgScope(orgId, (tx) => tx.consultantOrg.findUnique({ where: { id: orgId } }));
        if (owner && org) {
          const amount = ((invoice.amount_paid ?? 0) / 100).toFixed(2);
          const currency = (invoice.currency ?? "usd").toUpperCase();
          const message = receipt({
            orgName: org.name,
            description: invoice.lines?.data?.[0]?.description ?? "CloseCheck subscription",
            amountFormatted: `${amount} ${currency}`,
          });
          await sendEmail({
            orgId,
            to: owner.email,
            subject: message.subject,
            template: "receipt",
            html: message.html,
            text: message.text,
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    void recordError("stripe-webhook", err instanceof Error ? err : new Error(String(err)));
    // 500 makes Stripe retry with backoff — correct for transient DB failures; poison events would
    // keep failing, which shows up in the Stripe dashboard's failed-delivery view.
    return NextResponse.json({ error: "Webhook handling failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
