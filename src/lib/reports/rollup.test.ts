import { describe, expect, it } from "vitest";
import { Severity, Tier } from "@prisma/client";
import { computeSeverityRollup, worstSeverity, type FindingForRollup } from "./rollup";

// PASS is the neutral default now that IN_PROGRESS carries a meaning of its own: a rating a human
// has not confirmed. Cases about that state say IN_PROGRESS explicitly.
function finding(tier: Tier, severity: Severity | null, status = "PASS"): FindingForRollup {
  return { severity, status, templateItem: { tier } };
}

describe("worstSeverity", () => {
  it("returns GREEN for an empty list", () => {
    expect(worstSeverity([])).toBe(Severity.GREEN);
  });

  it("ignores null/undefined entries", () => {
    expect(worstSeverity([null, undefined, Severity.GREEN])).toBe(Severity.GREEN);
  });

  it("is worst-case, not majority or average — one RED among many GREENs is still RED", () => {
    const mostlyGreen = [
      Severity.GREEN,
      Severity.GREEN,
      Severity.GREEN,
      Severity.GREEN,
      Severity.RED,
    ];
    expect(worstSeverity(mostlyGreen)).toBe(Severity.RED);
  });

  it("YELLOW beats GREEN but loses to RED", () => {
    expect(worstSeverity([Severity.GREEN, Severity.YELLOW])).toBe(Severity.YELLOW);
    expect(worstSeverity([Severity.YELLOW, Severity.RED])).toBe(Severity.RED);
  });
});

describe("computeSeverityRollup", () => {
  it("computes each tier as the worst finding within it, and overall as the worst tier", () => {
    const findings: FindingForRollup[] = [
      finding(Tier.A, Severity.GREEN),
      finding(Tier.A, Severity.YELLOW),
      finding(Tier.B, Severity.RED), // per docs/spec.md §6: this alone must make Tier B (and overall) RED
      finding(Tier.C, Severity.GREEN),
    ];

    const result = computeSeverityRollup(findings);

    expect(result.perTier.A).toBe(Severity.YELLOW);
    expect(result.perTier.B).toBe(Severity.RED);
    expect(result.perTier.C).toBe(Severity.GREEN);
    expect(result.overall).toBe(Severity.RED);
  });

  it("treats unrated findings (null severity) as not contributing, not as GREEN pass evidence", () => {
    const findings: FindingForRollup[] = [
      finding(Tier.A, null),
      finding(Tier.A, null),
    ];
    const result = computeSeverityRollup(findings);
    // No rated findings in Tier A -> worstSeverity of an empty effective list -> GREEN default.
    // This is a deliberate default (see worstSeverity's empty-list behavior) — callers MUST check
    // perTierCoverage/overallCoverage before displaying this GREEN as if it meant "verified safe"
    // (found via UI testing: a brand-new, 0%-rated audit rendered "Overall: GREEN" with no
    // indication nothing had been checked yet — see src/lib/reports/renderHtml.ts and the audit
    // page, both of which now render coverage alongside every severity badge).
    expect(result.perTier.A).toBe(Severity.GREEN);
    expect(result.overall).toBe(Severity.GREEN);
    expect(result.perTierCoverage.A).toEqual({ rated: 0, total: 2, provisional: 0 });
    expect(result.overallCoverage).toEqual({ rated: 0, total: 2, provisional: 0 });
  });

  it("an empty findings list rolls up to GREEN overall", () => {
    expect(computeSeverityRollup([]).overall).toBe(Severity.GREEN);
  });

  it("coverage counts rated vs. total per tier and overall", () => {
    const findings: FindingForRollup[] = [
      finding(Tier.A, Severity.GREEN),
      finding(Tier.A, null),
      finding(Tier.B, Severity.RED),
      finding(Tier.C, null),
      finding(Tier.C, null),
    ];
    const result = computeSeverityRollup(findings);
    expect(result.perTierCoverage.A).toEqual({ rated: 1, total: 2, provisional: 0 });
    expect(result.perTierCoverage.B).toEqual({ rated: 1, total: 1, provisional: 0 });
    expect(result.perTierCoverage.C).toEqual({ rated: 0, total: 2, provisional: 0 });
    expect(result.overallCoverage).toEqual({ rated: 2, total: 5, provisional: 0 });
  });

  it("excludes NOT_APPLICABLE findings from the coverage denominator entirely", () => {
    const findings: FindingForRollup[] = [
      finding(Tier.A, Severity.GREEN),
      finding(Tier.A, null, "NOT_APPLICABLE"),
      finding(Tier.A, null, "NOT_APPLICABLE"),
    ];
    const result = computeSeverityRollup(findings);
    // Two NOT_APPLICABLE items don't count toward "still needs a rating" — only the one applicable,
    // rated item does. Found via QA: counting them made a fully-resolved audit misread as having
    // open work (spec.md §6's traffic-light summary is the one artifact a buyer actually reads).
    expect(result.perTierCoverage.A).toEqual({ rated: 1, total: 1, provisional: 0 });
    expect(result.overallCoverage).toEqual({ rated: 1, total: 1, provisional: 0 });
  });

  it("an audit where every finding is NOT_APPLICABLE rolls up to zero-total coverage, not zero-rated", () => {
    const findings: FindingForRollup[] = [
      finding(Tier.A, null, "NOT_APPLICABLE"),
      finding(Tier.B, null, "NOT_APPLICABLE"),
    ];
    const result = computeSeverityRollup(findings);
    // total: 0, not total: 2 — callers (renderHtml.ts, the audit page) use this to render "Not
    // applicable" instead of "Not yet rated": every item here is resolved (correctly excluded from
    // scope), none are pending.
    expect(result.overallCoverage).toEqual({ rated: 0, total: 0, provisional: 0 });
    expect(result.overall).toBe(Severity.GREEN);
  });
});

describe("ratings a human has not confirmed", () => {
  /**
   * Tier A's automated checks write a status AND a severity in one pass, so a consultant who runs
   * them and stops has findings that read as rated while their own notes say "this is a
   * fingerprint, not an assertion". Measured against a real template before this existed: seven of
   * eleven Tier A items rated, every one of them the machine's, and nothing anywhere saying so.
   */
  it("counts a rated IN_PROGRESS finding as provisional", () => {
    const result = computeSeverityRollup([
      finding(Tier.A, Severity.YELLOW, "IN_PROGRESS"),
      finding(Tier.A, Severity.GREEN, "IN_PROGRESS"),
      finding(Tier.A, Severity.GREEN, "PASS"),
    ]);
    expect(result.perTierCoverage.A).toEqual({ rated: 3, total: 3, provisional: 2 });
  });

  it("does not count an IN_PROGRESS finding with no severity", () => {
    // `rated` already says this one is outstanding. Counting it as provisional too would report the
    // same gap twice and make "3 rated, 4 awaiting confirmation" possible.
    const result = computeSeverityRollup([
      finding(Tier.A, null, "IN_PROGRESS"),
      finding(Tier.A, Severity.GREEN, "IN_PROGRESS"),
    ]);
    expect(result.perTierCoverage.A).toEqual({ rated: 1, total: 2, provisional: 1 });
    expect(result.perTierCoverage.A.provisional).toBeLessThanOrEqual(result.perTierCoverage.A.rated);
  });

  it("never reports more provisional than rated, whatever the mix", () => {
    for (const status of ["IN_PROGRESS", "PASS", "FAIL", "BLOCKED", "NOT_STARTED", "NOT_APPLICABLE"]) {
      for (const severity of [null, Severity.GREEN, Severity.RED]) {
        const { overallCoverage: c } = computeSeverityRollup([finding(Tier.B, severity, status)]);
        expect(c.provisional, `${status}/${severity}`).toBeLessThanOrEqual(c.rated);
        expect(c.rated).toBeLessThanOrEqual(c.total);
      }
    }
  });

  it("excludes NOT_APPLICABLE even when it is somehow IN_PROGRESS and rated", () => {
    // NOT_APPLICABLE leaves the denominator entirely, so it cannot re-enter through this count.
    const result = computeSeverityRollup([
      finding(Tier.A, Severity.RED, "NOT_APPLICABLE"),
      finding(Tier.A, Severity.GREEN, "PASS"),
    ]);
    expect(result.perTierCoverage.A).toEqual({ rated: 1, total: 1, provisional: 0 });
  });

  it("leaves the severity reduction alone — a provisional RED is still RED", () => {
    // The temptation this resists: discounting unconfirmed ratings out of the roll-up. A machine
    // finding a domain expired is a real risk a buyer must see, and suppressing it until someone
    // ticks a box would hide risk rather than qualify it. spec.md §6's worst-case rule is not
    // conditional on who did the rating.
    const result = computeSeverityRollup([
      finding(Tier.A, Severity.RED, "IN_PROGRESS"),
      finding(Tier.A, Severity.GREEN, "PASS"),
    ]);
    expect(result.perTier.A).toBe(Severity.RED);
    expect(result.overall).toBe(Severity.RED);
    expect(result.perTierCoverage.A.provisional).toBe(1);
  });
});
