import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BillingPlan } from "@prisma/client";
import {
  includedAuditsPerYear,
  isBillingConfigured,
  isEnforcementEnabled,
  planForPriceId,
  priceIdForPlan,
} from "./config";

const SAVED = { ...process.env };

beforeEach(() => {
  // Start each test from a clean billing env so leakage between cases can't mask a bug.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("STRIPE_") || key.startsWith("BILLING_")) delete process.env[key];
  }
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("isBillingConfigured", () => {
  it("is false without both Stripe keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(isBillingConfigured()).toBe(false);
  });
  it("is true with both keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    expect(isBillingConfigured()).toBe(true);
  });
});

describe("isEnforcementEnabled", () => {
  it("defaults off and only 'true' turns it on", () => {
    expect(isEnforcementEnabled()).toBe(false);
    process.env.BILLING_ENFORCEMENT = "1";
    expect(isEnforcementEnabled()).toBe(false);
    process.env.BILLING_ENFORCEMENT = "true";
    expect(isEnforcementEnabled()).toBe(true);
  });
});

describe("price ↔ plan mapping", () => {
  it("round-trips a configured price id", () => {
    process.env.STRIPE_PRICE_SOLO_ANNUAL = "price_solo_annual";
    expect(priceIdForPlan(BillingPlan.SOLO_ANNUAL)).toBe("price_solo_annual");
    expect(planForPriceId("price_solo_annual")).toBe(BillingPlan.SOLO_ANNUAL);
  });
  it("returns null for unconfigured plan and unknown price", () => {
    expect(priceIdForPlan(BillingPlan.TEAM_MONTHLY)).toBeNull();
    expect(planForPriceId("price_unknown")).toBeNull();
  });
});

describe("includedAuditsPerYear", () => {
  it("uses documented defaults (annual 6, monthly 3) when unset", () => {
    expect(includedAuditsPerYear(BillingPlan.SOLO_ANNUAL)).toBe(6);
    expect(includedAuditsPerYear(BillingPlan.SOLO_MONTHLY)).toBe(3);
  });
  it("honors env overrides and rejects garbage back to the default", () => {
    process.env.BILLING_INCLUDED_AUDITS_ANNUAL = "10";
    process.env.BILLING_INCLUDED_AUDITS_MONTHLY = "notanumber";
    expect(includedAuditsPerYear(BillingPlan.TEAM_ANNUAL)).toBe(10);
    expect(includedAuditsPerYear(BillingPlan.TEAM_MONTHLY)).toBe(3);
  });
});
