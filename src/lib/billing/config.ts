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

export function priceIdForPlan(plan: BillingPlan): string | null {
  return process.env[PRICE_ENV[plan]] || null;
}

export function planForPriceId(priceId: string): BillingPlan | null {
  for (const plan of Object.keys(PRICE_ENV) as BillingPlan[]) {
    if (process.env[PRICE_ENV[plan]] === priceId) return plan;
  }
  return null;
}

export function overagePriceId(): string | null {
  return process.env.STRIPE_PRICE_AUDIT_OVERAGE || null;
}

/** Included full-audit credits granted per billing YEAR (spec.md §9: "2–3 included per year" solo
 * monthly, ~6 bundled on annual). Monthly plans still grant yearly (see credits.ts's anniversary
 * logic) — per-month fractional credits would misrepresent the model being tested. */
export function includedAuditsPerYear(plan: BillingPlan): number {
  const annual = plan === "SOLO_ANNUAL" || plan === "TEAM_ANNUAL";
  const raw = annual
    ? process.env.BILLING_INCLUDED_AUDITS_ANNUAL
    : process.env.BILLING_INCLUDED_AUDITS_MONTHLY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return annual ? 6 : 3;
}

/** Display copy for the settings/pricing surfaces — labels only; amounts render from Stripe. */
export const PLAN_LABELS: Record<BillingPlan, string> = {
  SOLO_MONTHLY: "Solo — monthly",
  SOLO_ANNUAL: "Solo — annual (best value)",
  TEAM_MONTHLY: "Team — monthly",
  TEAM_ANNUAL: "Team — annual (best value)",
};
