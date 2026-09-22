import type { BillingPlan } from "@prisma/client";

/**
 * Billing configuration, docs/roadmap.md Phase 2.5 / spec.md §9 (revised 2026-09-21).
 *
 * Everything here is deliberately env-driven, not hardcoded: every price and credit count is an
 * untested hypothesis until the Phase 0 head-to-head test runs (roadmap Phase 2.5's stated primary
 * risk is mistaking "billing exists" for "pricing validated"), so changing a number must never
 * require a code change. Stripe price IDs are created in the dashboard; amounts live there, not here.
 */
export function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

/** Gate for consumption/blocking (docs/releases.md §5: ships dark until the launch gates are met).
 * Credits are still recorded when billing is configured; with enforcement off nothing is ever
 * blocked or invoiced. */
export function isEnforcementEnabled(): boolean {
  return process.env.BILLING_ENFORCEMENT === "true";
}

const PRICE_ENV: Record<BillingPlan, string> = {
  SOLO_MONTHLY: "STRIPE_PRICE_SOLO_MONTHLY",
  SOLO_ANNUAL: "STRIPE_PRICE_SOLO_ANNUAL",
  TEAM_MONTHLY: "STRIPE_PRICE_TEAM_MONTHLY",
  TEAM_ANNUAL: "STRIPE_PRICE_TEAM_ANNUAL",
};

export function isAnnual(plan: BillingPlan): boolean {
  return plan === "SOLO_ANNUAL" || plan === "TEAM_ANNUAL";
}

export function isTeam(plan: BillingPlan): boolean {
  return plan === "TEAM_MONTHLY" || plan === "TEAM_ANNUAL";
}

/**
 * The raw env price for a plan slot. Prefer basePriceIdForPlan/seatPriceIdForPlan at call sites —
 * see their comment for why a Team plan is not a single price.
 */
export function priceIdForPlan(plan: BillingPlan): string | null {
  return process.env[PRICE_ENV[plan]] || null;
}

/**
 * A Team subscription is NOT one price. spec.md §9 defines the Team tier as "additional seats at
 * $20–30/seat/mo **on top of the base**" — so a Team subscription is the same base subscription a
 * Solo org buys, plus one per-seat line for each seat beyond the first.
 *
 * That makes STRIPE_PRICE_TEAM_* the price of ONE ADDITIONAL SEAT, not the price of a Team plan.
 * The configured Stripe prices confirm this reading rather than leaving it to interpretation: the
 * Solo prices are $35/mo and $348/yr, the Team prices $25/mo and $249/yr, and each annual number is
 * ~17% off twelve of its own monthly one ($420→$348, $300→$249) — the exact annual discount §9's
 * second revision note specifies. $25/mo is the §9 per-seat band ($20–30), not a plan total.
 *
 * Treating the Team price as a whole-plan price (which this module did until 2026-09-22) made a
 * Team subscription cost $25/mo against Solo's $35/mo — a firm paid less than a solo consultant, and
 * extra seats were free. See the seat helpers below and src/lib/billing/seats.ts.
 */
export function basePriceIdForPlan(plan: BillingPlan): string | null {
  return isAnnual(plan)
    ? process.env.STRIPE_PRICE_SOLO_ANNUAL || null
    : process.env.STRIPE_PRICE_SOLO_MONTHLY || null;
}

/** The per-additional-seat price for a Team plan; null for Solo, which has no seat line at all. */
export function seatPriceIdForPlan(plan: BillingPlan): string | null {
  if (!isTeam(plan)) return null;
  return process.env[PRICE_ENV[plan]] || null;
}

/**
 * Resolves a Stripe subscription's price ids back to a plan. Order matters: a Team subscription
 * carries BOTH the shared base price and a seat price, so the presence of a seat price is what
 * distinguishes Team from Solo. Checking the base price first would classify every Team
 * subscription as Solo.
 */
export function planForPriceIds(priceIds: readonly string[]): BillingPlan | null {
  const ids = new Set(priceIds);
  for (const plan of ["TEAM_ANNUAL", "TEAM_MONTHLY"] as BillingPlan[]) {
    const seatPrice = seatPriceIdForPlan(plan);
    if (seatPrice && ids.has(seatPrice)) return plan;
  }
  for (const plan of ["SOLO_ANNUAL", "SOLO_MONTHLY"] as BillingPlan[]) {
    const basePrice = process.env[PRICE_ENV[plan]];
    if (basePrice && ids.has(basePrice)) return plan;
  }
  return null;
}

export function planForPriceId(priceId: string): BillingPlan | null {
  return planForPriceIds([priceId]);
}

/**
 * Seat allowance per plan (spec.md §9's table: Solo 1 seat, Team "up to ~5"). Env-overridable for
 * the same reason every other number here is: none of them has survived the Phase 0 head-to-head
 * test yet, so changing one must never need a code change.
 *
 * An org with no plan gets 1 seat, matching Solo — but note that enforcement is gated on
 * isEnforcementEnabled(), so while billing ships dark nothing is ever actually refused.
 */
export function maxSeatsForPlan(plan: BillingPlan | null): number {
  if (plan && isTeam(plan)) {
    const raw = process.env.BILLING_TEAM_MAX_SEATS;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 5;
  }
  return 1;
}

export function overagePriceId(): string | null {
  return process.env.STRIPE_PRICE_AUDIT_OVERAGE || null;
}

/** Included full-audit credits granted per billing YEAR (spec.md §9: "2–3 included per year" solo
 * monthly, ~6 bundled on annual). Monthly plans still grant yearly (see credits.ts's anniversary
 * logic) — per-month fractional credits would misrepresent the model being tested. */
export function includedAuditsPerYear(plan: BillingPlan, seats: number = 1): number {
  const annual = isAnnual(plan);
  const raw = annual
    ? process.env.BILLING_INCLUDED_AUDITS_ANNUAL
    : process.env.BILLING_INCLUDED_AUDITS_MONTHLY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const perSeat = Number.isFinite(parsed) && parsed >= 0 ? parsed : annual ? 6 : 3;

  // spec.md §9's tier table gives Team "included audits: scales with seats" — a five-person firm
  // running five consultants' deal flow through one account should not get a solo consultant's
  // bundle. Solo is always one seat, so this multiplication is a no-op there.
  if (!isTeam(plan)) return perSeat;
  const effectiveSeats = Math.max(1, Math.min(Math.trunc(seats), maxSeatsForPlan(plan)));
  return perSeat * effectiveSeats;
}

/** Display copy for the settings/pricing surfaces — labels only; amounts render from Stripe. */
export const PLAN_LABELS: Record<BillingPlan, string> = {
  SOLO_MONTHLY: "Solo — monthly",
  SOLO_ANNUAL: "Solo — annual (best value)",
  TEAM_MONTHLY: "Team — monthly",
  TEAM_ANNUAL: "Team — annual (best value)",
};
