import type { BillingPlan } from "@prisma/client";
import type { ScopedTx } from "@/lib/db/scoped";
import { withOrgScope } from "@/lib/db/scoped";
import { getStripe } from "./stripe";
import {
  isBillingConfigured,
  isEnforcementEnabled,
  isTeam,
  maxSeatsForPlan,
  seatPriceIdForPlan,
} from "./config";
import { recordError } from "@/lib/metrics/record";

/**
 * Seat accounting for the Team tier (spec.md §9: "additional seats at $20–30/seat/mo on top of the
 * base", "up to ~5" seats).
 *
 * Until 2026-09-22 none of this existed: a Team subscription was a single flat price, extra seats
 * were free, and nothing stopped a Solo org from inviting an unlimited number of teammates. The
 * pricing page has been advertising per-seat pricing and a ~5-seat cap the whole time, so this
 * closes the gap between what is sold and what is billed.
 *
 * Two deliberate boundaries:
 *
 * - **The first seat is included in the base.** §9 says additional seats sit "on top of the base",
 *   so the billable seat quantity is (members - 1), never (members). A one-person Team org
 *   therefore costs exactly what Solo costs, which is correct — and is also why Team can never come
 *   out cheaper than Solo, the bug this module exists to make structurally impossible.
 * - **Nothing is refused while billing ships dark.** Seat-cap enforcement is gated on
 *   isEnforcementEnabled() (docs/releases.md §5 — BILLING_ENFORCEMENT=false until a real charge has
 *   been processed), exactly like credit consumption. The counting and the Stripe quantity sync
 *   still run, so the numbers are right the moment enforcement is switched on.
 */

/** Every User row in the org is a seat. There is no "inactive user" concept — removal is deletion
 * (src/lib/actions/team.ts), so a simple count is the whole truth. */
export async function countSeats(tx: ScopedTx, orgId: string): Promise<number> {
  return tx.user.count({ where: { orgId } });
}

/** Seats beyond the one the base subscription already covers — the quantity of the Stripe seat line. */
export function billableSeatQuantity(seats: number): number {
  return Math.max(0, seats - 1);
}

export type SeatCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether the org can take on one more member. Call inside the same transaction that creates the
 * user, after taking the advisory lock below — two concurrent invites at the cap would otherwise
 * both read seats = cap - 1 and both commit.
 */
export async function checkSeatAvailable(
  tx: ScopedTx,
  orgId: string,
  plan: BillingPlan | null,
): Promise<SeatCheck> {
  if (!isBillingConfigured() || !isEnforcementEnabled()) return { allowed: true };

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seats:${orgId}`}))`;

  const seats = await countSeats(tx, orgId);
  const max = maxSeatsForPlan(plan);
  if (seats + 1 <= max) return { allowed: true };

  return {
    allowed: false,
    reason:
      plan && isTeam(plan)
        ? `Your plan covers ${max} seat${max === 1 ? "" : "s"} and all of them are in use. Remove a teammate, or contact us about a Firm plan.`
        : "The Solo plan is a single seat. Switch to a Team plan on the Settings page to invite teammates.",
  };
}

/**
 * Pushes the org's current seat count to Stripe as the quantity of the subscription's seat line.
 *
 * Called after a membership change commits, NOT inside its transaction: a Stripe round trip inside
 * a Postgres transaction would hold the row locks open across a network call, and a Stripe failure
 * must not roll back a teammate who was legitimately added or removed. The trade-off is that a
 * failed sync leaves Stripe's quantity stale — so failures are recorded to error_events rather than
 * swallowed, and scripts/ops-error-triage.ts surfaces them. Stripe is the billing system of record
 * for money; the User table is the system of record for seats, and this reconciles the two in that
 * direction only.
 *
 * Never throws: every caller is a user-facing action whose own work has already committed.
 */
export async function syncSeatQuantity(orgId: string): Promise<void> {
  try {
    if (!isBillingConfigured()) return;
    const stripe = getStripe();
    if (!stripe) return;

    const { account, seats } = await withOrgScope(orgId, async (tx) => ({
      account: await tx.billingAccount.findUnique({ where: { orgId } }),
      seats: await countSeats(tx, orgId),
    }));

    if (!account?.stripeSubscriptionId || !account.plan) return;
    if (account.status !== "ACTIVE" && account.status !== "PAST_DUE") return;

    const seatPriceId = seatPriceIdForPlan(account.plan);
    // Solo has no seat line. An over-cap Solo org is a billing question for the founder, not
    // something to silently start charging per seat for.
    if (!seatPriceId) return;

    const quantity = billableSeatQuantity(seats);
    const subscription = await stripe.subscriptions.retrieve(account.stripeSubscriptionId);
    const seatItem = subscription.items.data.find((item) => item.price?.id === seatPriceId);

    if (!seatItem) {
      if (quantity === 0) return;
      await stripe.subscriptionItems.create({
        subscription: subscription.id,
        price: seatPriceId,
        quantity,
        // Seats are added and removed mid-cycle; proration is the honest default — the firm pays for
        // the part of the period each seat actually existed for.
        proration_behavior: "create_prorations",
      });
      return;
    }

    if (seatItem.quantity === quantity) return;

    if (quantity === 0) {
      await stripe.subscriptionItems.del(seatItem.id, { proration_behavior: "create_prorations" });
      return;
    }

    await stripe.subscriptionItems.update(seatItem.id, {
      quantity,
      proration_behavior: "create_prorations",
    });
  } catch (err) {
    void recordError("billing-seat-sync", err instanceof Error ? err : new Error(String(err)), { orgId });
  }
}
