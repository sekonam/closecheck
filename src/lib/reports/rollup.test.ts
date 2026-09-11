import { describe, expect, it } from "vitest";
import { Severity, Tier } from "@prisma/client";
import { computeSeverityRollup, worstSeverity, type FindingForRollup } from "./rollup";

function finding(tier: Tier, severity: Severity | null): FindingForRollup {
  return { severity, templateItem: { tier } };
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
    expect(result.perTierCoverage.A).toEqual({ rated: 0, total: 2 });
    expect(result.overallCoverage).toEqual({ rated: 0, total: 2 });
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
    expect(result.perTierCoverage.A).toEqual({ rated: 1, total: 2 });
    expect(result.perTierCoverage.B).toEqual({ rated: 1, total: 1 });
    expect(result.perTierCoverage.C).toEqual({ rated: 0, total: 2 });
    expect(result.overallCoverage).toEqual({ rated: 2, total: 5 });
  });
});
