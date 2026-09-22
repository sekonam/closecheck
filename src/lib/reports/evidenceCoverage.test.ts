import { EvidenceExpectation, Severity, Tier } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  computeEvidenceCoverage,
  isEvidenceSatisfied,
  type FindingForEvidenceCoverage,
} from "./evidenceCoverage";

function finding(overrides: Partial<FindingForEvidenceCoverage> = {}): FindingForEvidenceCoverage {
  return {
    severity: null,
    status: "IN_PROGRESS",
    structuredData: null,
    evidence: [],
    templateItem: { tier: Tier.B, evidenceExpectation: EvidenceExpectation.DOCUMENT },
    ...overrides,
  };
}

describe("isEvidenceSatisfied", () => {
  it("needs an uploaded document for a Tier B item", () => {
    expect(isEvidenceSatisfied(finding())).toBe(false);
    expect(isEvidenceSatisfied(finding({ evidence: [{}] }))).toBe(true);
  });

  it("does not accept structured fields in place of the document", () => {
    // The contract's terms are a claim ABOUT a document. Typing the terms in without attaching the
    // contract leaves the claim with no source a buyer could check.
    expect(isEvidenceSatisfied(finding({ structuredData: { transferable: "no" } }))).toBe(false);
  });

  it("accepts a recorded attestation for a Tier C item", () => {
    const tierC = {
      templateItem: { tier: Tier.C, evidenceExpectation: EvidenceExpectation.ATTESTATION },
    };
    expect(isEvidenceSatisfied(finding({ ...tierC }))).toBe(false);
    expect(isEvidenceSatisfied(finding({ ...tierC, structuredData: { observation: "Logged in." } }))).toBe(true);
    // A screenshot is direct evidence of the same check.
    expect(isEvidenceSatisfied(finding({ ...tierC, evidence: [{}] }))).toBe(true);
  });

  it("treats an empty structuredData object as no attestation", () => {
    const tierC = {
      templateItem: { tier: Tier.C, evidenceExpectation: EvidenceExpectation.ATTESTATION },
    };
    expect(isEvidenceSatisfied(finding({ ...tierC, structuredData: {} }))).toBe(false);
    expect(isEvidenceSatisfied(finding({ ...tierC, structuredData: [] }))).toBe(false);
  });

  it("expects nothing where nothing is declared", () => {
    expect(
      isEvidenceSatisfied(
        finding({ templateItem: { tier: Tier.A, evidenceExpectation: EvidenceExpectation.NONE } }),
      ),
    ).toBe(true);
  });
});

describe("computeEvidenceCoverage", () => {
  it("counts supported against expected, per tier and overall", () => {
    const result = computeEvidenceCoverage([
      finding({ evidence: [{}] }),
      finding(),
      finding({
        templateItem: { tier: Tier.C, evidenceExpectation: EvidenceExpectation.ATTESTATION },
        structuredData: { observation: "x" },
      }),
      finding({ templateItem: { tier: Tier.A, evidenceExpectation: EvidenceExpectation.NONE } }),
    ]);

    expect(result.perTier.B).toEqual({ supported: 1, expected: 2 });
    expect(result.perTier.C).toEqual({ supported: 1, expected: 1 });
    // Items expecting nothing are out of the denominator entirely — otherwise every Tier A item
    // would permanently read as un-evidenced.
    expect(result.perTier.A).toEqual({ supported: 0, expected: 0 });
    expect(result.overall).toEqual({ supported: 2, expected: 3 });
  });

  it("excludes not-applicable findings, matching the severity roll-up", () => {
    const result = computeEvidenceCoverage([
      finding({ status: "NOT_APPLICABLE" }),
      finding({ evidence: [{}] }),
    ]);
    expect(result.overall).toEqual({ supported: 1, expected: 1 });
  });

  it("counts a rating with nothing behind it", () => {
    const result = computeEvidenceCoverage([
      finding({ severity: Severity.GREEN }), // rated, no document — the case worth surfacing
      finding({ severity: Severity.RED, evidence: [{}] }), // rated and documented
      finding(), // unrated and undocumented: just work not done yet
    ]);
    expect(result.unsupportedRatedCount).toBe(1);
  });

  it("does not count a not-applicable finding as unsupported even if it kept a severity", () => {
    const result = computeEvidenceCoverage([
      finding({ status: "NOT_APPLICABLE", severity: Severity.RED }),
    ]);
    expect(result.unsupportedRatedCount).toBe(0);
  });

  it("returns zeroes for an empty audit rather than dividing by nothing", () => {
    const result = computeEvidenceCoverage([]);
    expect(result.overall).toEqual({ supported: 0, expected: 0 });
    expect(result.unsupportedRatedCount).toBe(0);
  });
});
