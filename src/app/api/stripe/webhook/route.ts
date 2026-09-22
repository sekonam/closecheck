import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { BillingStatus, type BillingPlan } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { getStripe } from "@/lib/billing/stripe";
import { resolveSubscriptionPlan } from "@/lib/billing/config";
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
 * The plan the org actually bought.
 *
 * Prefers the `plan` written into subscription metadata at checkout (src/lib/actions/billing.ts),
 * because the price lines cannot always answer this. A Team subscription is the shared base price
 * plus one per-seat line for every seat beyond the first, so a Team org with ONE member has no seat
 * line and is byte-identical to Solo. Inference alone therefore mislabelled it — and mislabelled it
 * again, in reverse, whenever a two-person Team dropped to one member and syncSeatQuantity removed
 * the seat item, silently downgrading a paying firm mid-cycle and re-granting a full year of
 * credits under the new plan name.
 *
 * Metadata is server-set at checkout and arrives inside a signature-verified event, so it is
 * trusted on exactly the same footing as metadata.orgId. It is validated against the enum rather
 * than cast, since a value written by an older deploy (or by hand in the dashboard) must not become
 * an unchecked plan.
 *
 * Falls back to reading EVERY price line — not items.data[0], since Stripe does not guarantee item
 * order — for subscriptions created before the metadata existed.
 */
function planFromSubscription(subscription: Stripe.Subscription): BillingPlan | null {
  const priceIds = subscription.items.data
    .map((item) => item.price?.id)
    .filter((id): id is string => !!id);
  return resolveSubscriptionPlan(priceIds, subscription.metadata?.plan);
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
async function applySubscriptionState(
  stripe: Stripe,
  orgId: string,
  subscription: Stripe.Subscription,
): Promise<boolean> {
  const plan = planFromSubscription(subscription);
  const status = mapStatus(subscription.status);
  const periodEnd = subscription.items.data[0]?.current_period_end;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return false;

  /**
   * Two independent statements of who owns this subscription — the org named in its own metadata,
   * and the org named on the customer it belongs to — must agree before either is written.
   *
   * Nothing compared them before. This is the same shape as the portal serving a report resolved
   * against one firm's link and another firm's identity, found in the same review pass, and it is
   * latent for the same reason: both values are written by this application and it always writes
   * the same one. What makes it worth closing anyway is that the consequence is not a failed
   * request. `stripeCustomerId` is unique per BillingAccount, so a mismatch resolves one of two
   * ways, and both are bad in a way nobody would notice. Updating an existing row repoints a firm's
   * billing account at another firm's Stripe customer, after which `invoice.paid` for that customer
   * resolves back to the other org — payments and credit grants split across two firms. Or the
   * unique constraint rejects it, producing the 500-and-retry-forever wedge already fixed once in
   * this file.
   *
   * Dashboard edits are the realistic source: metadata is editable by hand, and a support action on
   * a customer is exactly the moment someone would touch it.
   *
   * Refusing is the only safe reading, as with the portal — two sources disagreeing about ownership
   * describe a corrupt state, and guessing which one is right risks moving money between firms.
   */
  const customerOrgId = await orgIdFromCustomer(stripe, customerId);
  if (customerOrgId && customerOrgId !== orgId) {
    await recordError(
      "stripe-webhook-org-mismatch",
      new Error(
        `Subscription ${subscription.id} names org ${orgId} while customer ${customerId} names ` +
          `org ${customerOrgId}. Refusing to write either.`,
      ),
    );
    return false;
  }

  return withOrgScope(orgId, async (tx) => {
    // RLS scopes this to the org resolved from signature-verified Stripe metadata; a deleted org
    // simply has no row to find, which is the unrecoverable case above.
    const org = await tx.consultantOrg.findUnique({ where: { id: orgId } });
    if (!org) return false;

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
          if (!(await applySubscriptionState(stripe, orgId, subscription))) {
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
          if (!(await applySubscriptionState(stripe, orgId, subscription))) {
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
