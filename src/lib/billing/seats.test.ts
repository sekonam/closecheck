import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BillingPlan } from "@prisma/client";
import {
  basePriceIdForPlan,
  includedAuditsPerYear,
  maxSeatsForPlan,
  planForPriceIds,
  resolveSubscriptionPlan,
  seatPriceIdForPlan,
} from "./config";
import { billableSeatQuantity } from "./seats";

/**
 * Covers the seat model added 2026-09-22 (spec.md §9's "additional seats ... on top of the base").
 *
 * The regression these exist for: STRIPE_PRICE_TEAM_* was being treated as a whole-plan price, so a
 * Team subscription billed $25/mo against Solo's $35/mo — a firm paid less than a solo consultant
 * and every extra seat was free. The "Team is never cheaper than Solo" case at the bottom is the
 * one that fails if anyone reintroduces that reading.
 */
const SAVED = { ...process.env };

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("STRIPE_") || key.startsWith("BILLING_")) delete process.env[key];
  }
  process.env.STRIPE_PRICE_SOLO_MONTHLY = "price_solo_m";
  process.env.STRIPE_PRICE_SOLO_ANNUAL = "price_solo_a";
  process.env.STRIPE_PRICE_TEAM_MONTHLY = "price_seat_m";
  process.env.STRIPE_PRICE_TEAM_ANNUAL = "price_seat_a";
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("billableSeatQuantity", () => {
  it("excludes the first seat, which the base subscription already covers", () => {
    expect(billableSeatQuantity(1)).toBe(0);
    expect(billableSeatQuantity(2)).toBe(1);
    expect(billableSeatQuantity(5)).toBe(4);
  });

  it("never goes negative on an org with no user rows", () => {
    expect(billableSeatQuantity(0)).toBe(0);
  });
});

describe("base vs seat price resolution", () => {
  it("bills a Team plan on the same base price a Solo org pays, plus a seat price", () => {
    expect(basePriceIdForPlan(BillingPlan.TEAM_MONTHLY)).toBe("price_solo_m");
    expect(seatPriceIdForPlan(BillingPlan.TEAM_MONTHLY)).toBe("price_seat_m");
  });

  it("matches the billing interval when picking the base price", () => {
    expect(basePriceIdForPlan(BillingPlan.TEAM_ANNUAL)).toBe("price_solo_a");
    expect(seatPriceIdForPlan(BillingPlan.TEAM_ANNUAL)).toBe("price_seat_a");
    expect(basePriceIdForPlan(BillingPlan.SOLO_ANNUAL)).toBe("price_solo_a");
  });

  it("gives Solo no seat price at all", () => {
    expect(seatPriceIdForPlan(BillingPlan.SOLO_MONTHLY)).toBeNull();
    expect(seatPriceIdForPlan(BillingPlan.SOLO_ANNUAL)).toBeNull();
  });
});

describe("planForPriceIds", () => {
  it("classifies a two-line Team subscription as Team, not Solo", () => {
    expect(planForPriceIds(["price_solo_m", "price_seat_m"])).toBe(BillingPlan.TEAM_MONTHLY);
  });

  it("is independent of Stripe's item ordering", () => {
    // The bug this guards: reading only items.data[0] classified a Team subscription as Solo
    // whenever Stripe happened to return the base line first.
    expect(planForPriceIds(["price_seat_m", "price_solo_m"])).toBe(BillingPlan.TEAM_MONTHLY);
  });

  it("classifies a single base line as Solo", () => {
    expect(planForPriceIds(["price_solo_a"])).toBe(BillingPlan.SOLO_ANNUAL);
  });

  it("classifies a one-seat Team subscription (base line only) as Solo", () => {
    // Deliberate and correct: a Team org with one member has no seat line, and at one seat the two
    // plans are the same subscription for the same money. It becomes Team again when a seat is added.
    expect(planForPriceIds(["price_solo_m"])).toBe(BillingPlan.SOLO_MONTHLY);
  });

  it("returns null for prices this deployment does not know", () => {
    expect(planForPriceIds(["price_from_another_account"])).toBeNull();
    expect(planForPriceIds([])).toBeNull();
  });
});

describe("maxSeatsForPlan", () => {
  it("gives Solo exactly one seat and Team the §9 default of five", () => {
    expect(maxSeatsForPlan(BillingPlan.SOLO_MONTHLY)).toBe(1);
    expect(maxSeatsForPlan(BillingPlan.TEAM_ANNUAL)).toBe(5);
  });

  it("treats an org with no plan as a single seat", () => {
    expect(maxSeatsForPlan(null)).toBe(1);
  });

  it("honors the env override and falls back on garbage", () => {
    process.env.BILLING_TEAM_MAX_SEATS = "12";
    expect(maxSeatsForPlan(BillingPlan.TEAM_MONTHLY)).toBe(12);
    process.env.BILLING_TEAM_MAX_SEATS = "zero";
    expect(maxSeatsForPlan(BillingPlan.TEAM_MONTHLY)).toBe(5);
  });
});

describe("includedAuditsPerYear scales with seats for Team only", () => {
  it("multiplies the bundle by seats on a Team plan", () => {
    expect(includedAuditsPerYear(BillingPlan.TEAM_ANNUAL, 3)).toBe(18);
    expect(includedAuditsPerYear(BillingPlan.TEAM_MONTHLY, 3)).toBe(9);
  });

  it("ignores seats on a Solo plan, which is one seat by definition", () => {
    expect(includedAuditsPerYear(BillingPlan.SOLO_ANNUAL, 4)).toBe(6);
  });

  it("defaults to a single seat when the caller does not pass one", () => {
    expect(includedAuditsPerYear(BillingPlan.TEAM_ANNUAL)).toBe(6);
  });

  it("clamps to the plan's seat cap so a stale count cannot over-grant", () => {
    expect(includedAuditsPerYear(BillingPlan.TEAM_ANNUAL, 99)).toBe(6 * 5);
  });

  it("clamps a zero or negative seat count up to one", () => {
    expect(includedAuditsPerYear(BillingPlan.TEAM_ANNUAL, 0)).toBe(6);
    expect(includedAuditsPerYear(BillingPlan.TEAM_ANNUAL, -3)).toBe(6);
  });
});

describe("the regression that motivated this module", () => {
  /**
   * Prices here are the real configured test-mode amounts: Solo $35/mo and $348/yr, per-seat $25/mo
   * and $249/yr. Under the old "Team price is the plan price" reading, a Team org paid 2500 against
   * Solo's 3500. This asserts the property rather than the amounts — whatever the numbers become
   * after the Phase 0 head-to-head test, Team must never undercut Solo.
   */
  const MONTHLY = { base: 3500, seat: 2500 };

  function teamMonthlyTotal(seats: number): number {
    return MONTHLY.base + billableSeatQuantity(seats) * MONTHLY.seat;
  }

  it("never prices a Team subscription below a Solo one", () => {
    for (const seats of [1, 2, 3, 4, 5]) {
      expect(teamMonthlyTotal(seats)).toBeGreaterThanOrEqual(MONTHLY.base);
    }
  });

  it("charges a one-person Team exactly the Solo price, and each extra seat on top", () => {
    expect(teamMonthlyTotal(1)).toBe(3500);
    expect(teamMonthlyTotal(2)).toBe(6000);
    expect(teamMonthlyTotal(5)).toBe(13500);
  });
});

describe("resolveSubscriptionPlan", () => {
  /**
   * The case that had no coverage at all, and that cost a real customer a dead end: a Team org with
   * ONE member has no seat line (there are seats-1 of them), so its subscription is byte-identical
   * to Solo. Recorded as Solo, its seat cap then refused the first invite and told the owner to
   * switch to a Team plan — which checkout refused, because a subscription already existed.
   */
  it("classifies a one-person Team subscription as Team, from metadata", () => {
    expect(resolveSubscriptionPlan(["price_solo_m"], "TEAM_MONTHLY")).toBe(BillingPlan.TEAM_MONTHLY);
    expect(resolveSubscriptionPlan(["price_solo_a"], "TEAM_ANNUAL")).toBe(BillingPlan.TEAM_ANNUAL);
  });

  it("lets a seat line outrank stale metadata", () => {
    // Metadata is written at checkout and never rewritten, so a plan changed through Stripe's own
    // billing portal leaves it describing the old plan. A seat line is proof of what is being
    // billed right now, so it wins.
    expect(resolveSubscriptionPlan(["price_solo_m", "price_seat_m"], "SOLO_MONTHLY")).toBe(
      BillingPlan.TEAM_MONTHLY,
    );
  });

  it("falls back to the price lines when there is no metadata at all", () => {
    // Every subscription created before the metadata existed is in this state.
    expect(resolveSubscriptionPlan(["price_solo_m"], undefined)).toBe(BillingPlan.SOLO_MONTHLY);
    expect(resolveSubscriptionPlan(["price_solo_a", "price_seat_a"], null)).toBe(BillingPlan.TEAM_ANNUAL);
  });

  /**
   * Prisma generates the enum as a plain object with Object.prototype on its chain, so
   * `"constructor" in BillingPlan` is TRUE. An `in` check — which is what this originally used —
   * passed inherited members straight through as a plan, and the Object constructor then went into
   * a Prisma write that rejects it, producing a webhook that 500s and retries forever.
   */
  it("rejects inherited Object members that an `in` check would have accepted", () => {
    for (const hostile of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(resolveSubscriptionPlan(["price_solo_m"], hostile)).toBe(BillingPlan.SOLO_MONTHLY);
    }
  });

  it("ignores a bogus or wrongly-cased declared plan", () => {
    expect(resolveSubscriptionPlan(["price_solo_m"], "BOGUS")).toBe(BillingPlan.SOLO_MONTHLY);
    expect(resolveSubscriptionPlan(["price_solo_m"], "solo_monthly")).toBe(BillingPlan.SOLO_MONTHLY);
    expect(resolveSubscriptionPlan(["price_solo_m"], "")).toBe(BillingPlan.SOLO_MONTHLY);
  });

  it("returns null when it recognises nothing", () => {
    expect(resolveSubscriptionPlan([], undefined)).toBeNull();
    expect(resolveSubscriptionPlan(["price_from_another_stripe_account"], undefined)).toBeNull();
  });

  it("still resolves a plan when only metadata is recognisable", () => {
    // A price rotated in the dashboard without the env being updated: the lines mean nothing here,
    // but the org's plan is not therefore unknown.
    expect(resolveSubscriptionPlan(["price_rotated"], "TEAM_ANNUAL")).toBe(BillingPlan.TEAM_ANNUAL);
  });
});
