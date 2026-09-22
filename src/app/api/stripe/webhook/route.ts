import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { BillingStatus, type BillingPlan } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { getStripe } from "@/lib/billing/stripe";
import { planForPriceId } from "@/lib/billing/config";
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

function planFromSubscription(subscription: Stripe.Subscription): BillingPlan | null {
  const priceId = subscription.items.data[0]?.price?.id;
  return priceId ? planForPriceId(priceId) : null;
}

async function orgIdFromCustomer(stripe: Stripe, customerId: string): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;
  return customer.metadata?.orgId || null;
}

async function applySubscriptionState(orgId: string, subscription: Stripe.Subscription): Promise<void> {
  const plan = planFromSubscription(subscription);
  const status = mapStatus(subscription.status);
  const periodEnd = subscription.items.data[0]?.current_period_end;

  await withOrgScope(orgId, async (tx) => {
    await tx.billingAccount.update({
      where: { orgId },
      data: {
        stripeSubscriptionId: subscription.id,
        plan: plan ?? undefined,
        status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      },
    });
    if (status === BillingStatus.ACTIVE && plan) {
      await grantPlanCreditsIfDue(tx, orgId, plan);
    }
  });
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
          await applySubscriptionState(orgId, subscription);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const orgId = subscription.metadata?.orgId;
        if (orgId) {
          await applySubscriptionState(orgId, subscription);
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
