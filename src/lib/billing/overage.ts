import { withOrgScope } from "@/lib/db/scoped";
import { getStripe } from "@/lib/billing/stripe";
import { overagePriceId } from "@/lib/billing/config";
import { recordError } from "@/lib/metrics/record";
import type { BillableWorkResult } from "@/lib/billing/credits";

/**
 * What happens AFTER the transaction that consumed a credit commits.
 *
 * A billable overage becomes a Stripe invoice item — an external API call, never inside a database
 * transaction — which Stripe sweeps into the subscription's next monthly invoice: the batched
 * rollup billing the roadmap specifies, never a per-audit charge. Best-effort: a failure here loses
 * one overage line item, not the consultant's work, and is recorded so a reconciliation pass or the
 * founder can find the ones that never reached Stripe (the OVERAGE ledger row already exists).
 *
 * Lives here rather than in src/lib/actions/audits.ts, where it used to be module-private, because
 * consumption now happens in five actions across three files. It must NOT be exported from any
 * "use server" module: every export of such a module is a callable server action, and this takes
 * an orgId.
 */
export async function settleConsumeAfterCommit(
  orgId: string,
  auditId: string,
  consume: BillableWorkResult | null,
): Promise<void> {
  if (!consume || consume.outcome !== "overage" || !consume.billable) return;
  try {
    await recordOverageInvoiceItem(orgId, auditId);
  } catch (err) {
    void recordError("billing-overage", err instanceof Error ? err : new Error(String(err)), { orgId });
  }
}

/** Attaches one overage invoice item to the org's Stripe customer (batched onto the next rollup
 * invoice by Stripe). */
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
