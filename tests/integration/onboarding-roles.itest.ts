import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withOrgScope } from "@/lib/db/scoped";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

/**
 * The onboarding checklist across the two roles (spec.md §3).
 *
 * Its first two steps — firm branding, and accepting the report disclaimer — are firm-scoped and
 * owner-only. The checklist renders to every seat, so before this a member saw two incomplete items
 * instructing them to use controls they do not have, and would later be blocked from generating a
 * report by a prerequisite the checklist had told them to go and satisfy themselves.
 *
 * The decision being locked in here is that those steps stay VISIBLE to a member rather than being
 * hidden. An unacknowledged disclaimer blocks report generation for the whole firm, so a member who
 * cannot generate a report needs to know why — "waiting on the account owner" is a better answer
 * than an item that silently is not there. Hiding it would convert a firm-level prerequisite into
 * an unexplained failure later, which is the same shape as pointing someone at a control they
 * cannot use.
 */
describe("onboarding tells a member what is theirs and what is not", () => {
  let org: OrgFixture;

  async function statusFor(role: "OWNER" | "MEMBER") {
    return withOrgScope(org.orgId, (tx) => getOnboardingStatus(tx, org.orgId, role));
  }

  beforeAll(async () => {
    org = await createOrgFixture("onboarding");
    // Firm setup deliberately not done, which is the state the copy has to explain.
    await directPrisma.consultantOrg.update({
      where: { id: org.orgId },
      data: { brandLogoUrl: null, brandColorHex: null, disclaimerAcknowledgedAt: null },
    });
  });

  afterAll(async () => {
    if (org) await destroyOrgFixture(org.orgId);
  });

  it("marks exactly the firm-scoped steps as owner-only, for both roles", async () => {
    for (const role of ["OWNER", "MEMBER"] as const) {
      const status = await statusFor(role);
      const ownerOnly = status.steps.filter((s) => s.ownerOnly).map((s) => s.key);
      expect(ownerOnly, `role ${role}`).toEqual(["branding", "disclaimer"]);
    }
  });

  it("shows a member the same number of steps as an owner", async () => {
    const owner = await statusFor("OWNER");
    const member = await statusFor("MEMBER");
    expect(member.totalCount).toBe(owner.totalCount);
    expect(member.steps.map((s) => s.key)).toEqual(owner.steps.map((s) => s.key));
  });

  it("does not tell a member to use a control they do not have", async () => {
    const member = await statusFor("MEMBER");
    for (const step of member.steps.filter((s) => s.ownerOnly)) {
      // The owner-facing copy is an instruction ("Add your logo...", "A one-time review...").
      // A member must be told who does it instead.
      expect(step.detail.toLowerCase(), step.key).toContain("account owner");
      expect(step.detail, step.key).not.toMatch(/^Add your logo/);
    }
  });

  it("still gives an owner the actionable instruction", async () => {
    const owner = await statusFor("OWNER");
    const branding = owner.steps.find((s) => s.key === "branding");
    // Asserts the SHAPE of the copy — an imperative aimed at the reader — not its exact wording.
    // It used to require /Add your logo/, which pinned the sentence to an order that turned out to
    // be wrong: `done` for this step is `brandLogoUrl || brandColorHex`, so a firm that set only a
    // colour ticked the step off while the copy was still promising "logo and brand color". The
    // sentence now leads with the colour, because that is the part that always applies.
    expect(branding?.detail).toMatch(/^Add your/);
    expect(branding?.detail.toLowerCase(), "an owner is told to act, not who to ask").not.toContain(
      "account owner",
    );
    expect(branding?.waitingOnOwner, "an owner is never waiting on themselves").toBe(false);
  });

  it("flags an unfinished firm step as waiting on the owner, for a member only", async () => {
    const member = await statusFor("MEMBER");
    expect(member.steps.filter((s) => s.waitingOnOwner).map((s) => s.key)).toEqual([
      "branding",
      "disclaimer",
    ]);
    const owner = await statusFor("OWNER");
    expect(owner.steps.some((s) => s.waitingOnOwner)).toBe(false);
  });

  it("stops waiting once the owner has actually done it", async () => {
    await directPrisma.consultantOrg.update({
      where: { id: org.orgId },
      data: { brandColorHex: "#0d7a6f", disclaimerAcknowledgedAt: new Date() },
    });
    try {
      const member = await statusFor("MEMBER");
      expect(member.steps.some((s) => s.waitingOnOwner)).toBe(false);
      expect(member.steps.filter((s) => s.ownerOnly).every((s) => s.done)).toBe(true);
    } finally {
      await directPrisma.consultantOrg.update({
        where: { id: org.orgId },
        data: { brandColorHex: null, disclaimerAcknowledgedAt: null },
      });
    }
  });

  it("leaves every engagement-scoped step available to a member", async () => {
    const member = await statusFor("MEMBER");
    const work = member.steps.filter((s) => !s.ownerOnly).map((s) => s.key);
    // A seat that cannot do the diligence is a seat that cannot do what it is sold for.
    expect(work).toEqual(["engagement", "audit", "tier-a", "report", "share"]);
    expect(member.steps.filter((s) => !s.ownerOnly).every((s) => !s.waitingOnOwner)).toBe(true);
  });
});
