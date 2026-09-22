/**
 * How much of an audit's evidence is actually there, alongside how much of it is rated.
 *
 * `computeSeverityRollup` in rollup.ts already refuses to let a severity badge stand on its own,
 * because a brand-new audit with nothing rated rolls up to GREEN and reads as "verified safe". Its
 * docstring puts the principle plainly: *a severity badge is a claim that something was checked.*
 *
 * This applies that same principle one level deeper. Coverage currently answers "did the consultant
 * put a rating on this item", which a consultant can satisfy in one click. It does not answer "is
 * there anything behind the rating". A Tier B contract item can today be marked PASS/GREEN with no
 * document attached and every structured field blank, and both the audit page and the PDF present
 * it identically to one backed by an executed agreement and six filled fields. In a document whose
 * entire value is that a buyer can rely on it, those two are not the same claim.
 *
 * Deliberately a SIGNAL, NOT A GATE. `markAuditComplete` takes the considered position that
 * completion is a consultant's judgment call, and that stands: a seller who will not produce a
 * contract is a real situation with a real finding attached ("terms could not be obtained", which
 * the v3 severity guidance explicitly rates), and a product that refuses to let the consultant
 * record it would be worse than one that shows the gap. So this measures and displays; it never
 * blocks.
 */

import { EvidenceExpectation, Tier } from "@prisma/client";

export interface FindingForEvidenceCoverage {
  severity: unknown;
  status: string;
  structuredData?: unknown;
  evidence: Array<{ kind?: unknown }>;
  templateItem: { tier: Tier; evidenceExpectation: EvidenceExpectation };
}

export interface EvidenceCoverage {
  /** Items whose declared evidence expectation is satisfied. */
  supported: number;
  /** Items that declare an expectation at all — the honest denominator. */
  expected: number;
}

export interface EvidenceCoverageResult {
  perTier: Record<Tier, EvidenceCoverage>;
  overall: EvidenceCoverage;
  /**
   * Items carrying a severity with nothing behind it. These are the ones worth surfacing by name:
   * a rating that a buyer could ask about and the consultant could not answer.
   */
  unsupportedRatedCount: number;
}

/**
 * Is this finding's declared evidence expectation met?
 *
 * - DOCUMENT (Tier B): at least one uploaded document. A contract's terms are a claim about a
 *   document; without the document the claim has no source.
 * - ATTESTATION (Tier C): structured attestation values recorded. spec.md §4's decision not to
 *   handle credentials rests entirely on a named professional attesting to what they saw — so an
 *   empty attestation is the tier's whole premise going unmet. An uploaded screenshot counts too,
 *   since that is direct evidence of the same check.
 * - NONE: nothing is expected, so nothing is missing.
 */
export function isEvidenceSatisfied(finding: FindingForEvidenceCoverage): boolean {
  const expectation = finding.templateItem.evidenceExpectation;
  if (expectation === EvidenceExpectation.NONE) return true;

  if (expectation === EvidenceExpectation.DOCUMENT) {
    return finding.evidence.length > 0;
  }

  const hasAttestation =
    finding.structuredData != null &&
    typeof finding.structuredData === "object" &&
    !Array.isArray(finding.structuredData) &&
    Object.keys(finding.structuredData as Record<string, unknown>).length > 0;
  return hasAttestation || finding.evidence.length > 0;
}

export function computeEvidenceCoverage(
  findings: FindingForEvidenceCoverage[],
): EvidenceCoverageResult {
  const perTier: Record<Tier, EvidenceCoverage> = {
    A: { supported: 0, expected: 0 },
    B: { supported: 0, expected: 0 },
    C: { supported: 0, expected: 0 },
  };
  let unsupportedRatedCount = 0;

  for (const finding of findings) {
    // Same exclusion as the severity roll-up: an item that genuinely doesn't apply to this
    // business has no evidence to be missing, and counting it as a gap would misrepresent a
    // finished audit as having open work.
    if (finding.status === "NOT_APPLICABLE") continue;
    if (finding.templateItem.evidenceExpectation === EvidenceExpectation.NONE) continue;

    const tier = finding.templateItem.tier;
    perTier[tier].expected += 1;
    if (isEvidenceSatisfied(finding)) {
      perTier[tier].supported += 1;
    } else if (finding.severity) {
      unsupportedRatedCount += 1;
    }
  }

  return {
    perTier,
    overall: {
      supported: perTier.A.supported + perTier.B.supported + perTier.C.supported,
      expected: perTier.A.expected + perTier.B.expected + perTier.C.expected,
    },
    unsupportedRatedCount,
  };
}
