import { Severity, Tier } from "@prisma/client";

const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.GREEN]: 0,
  [Severity.YELLOW]: 1,
  [Severity.RED]: 2,
};

/**
 * spec.md §6: "any single Red item makes its tier Red regardless of how many Greens surround it."
 * This is a worst-case reduction, deliberately never an average — do not "fix" this into a weighted
 * or majority-vote scheme without a spec change (see .claude/skills/domain-code-review/SKILL.md,
 * which specifically checks this function for exactly that regression).
 */
export function worstSeverity(severities: Array<Severity | null | undefined>): Severity {
  let worst: Severity = Severity.GREEN;
  for (const s of severities) {
    if (!s) continue;
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

export interface FindingForRollup {
  severity: Severity | null;
  status: string;
  templateItem: { tier: Tier };
}

export interface Coverage {
  rated: number;
  total: number;
  /**
   * Of the rated ones, how many are still IN_PROGRESS — a severity that nobody has confirmed.
   *
   * Tier A's automated checks write a status AND a severity in one pass, so a consultant who runs
   * them and stops has findings that read as rated while their own notes say otherwise: "this is a
   * fingerprint, not an assertion", "confirm patch status manually". Coverage counted every one of
   * those, so an audit could report 7 of 11 rated with all seven awaiting a human.
   *
   * That is the same failure this field's parent was built to prevent, one level up: the docstring
   * on RollupResult.perTierCoverage says a severity badge is a claim that something was checked,
   * and a machine rating that asks to be checked is not yet that claim.
   *
   * Deliberately additive. `rated` keeps its meaning — a severity is present — and the roll-up
   * reduction is untouched, because a provisional YELLOW is still a real signal a buyer should see
   * and suppressing it would hide risk rather than qualify it. This says how much of the rating
   * is still the machine's, and lets the surfaces say so.
   */
  provisional: number;
}

export interface RollupResult {
  perTier: Record<Tier, Severity>;
  overall: Severity;
  /**
   * How many findings actually carry a severity, per tier and overall — found via UI testing
   * (running the app end-to-end, not just unit tests): a brand-new audit with zero rated findings
   * rolls up to GREEN (worstSeverity's documented empty-list default), which reads as "verified
   * safe" when really nothing has been checked yet. Callers (the audit page, the PDF report) MUST
   * show this alongside the severity badge — never render `overall`/`perTier` without it — so
   * "GREEN because nothing's rated" is visually distinct from "GREEN because it passed."
   */
  perTierCoverage: Record<Tier, Coverage>;
  overallCoverage: Coverage;
}

/**
 * Overall = worst tier rating; each tier's rating = worst finding rating within that tier.
 *
 * NOT_APPLICABLE findings are excluded from both the coverage denominator and the severity
 * computation entirely — found via QA: a checklist item that genuinely doesn't apply to this
 * business (e.g. "third-party delivery platform account ownership" for a restaurant with no
 * delivery integration) carries no risk to rate, so counting it as "not yet rated" misrepresented
 * a fully-resolved audit as still having open work. "Not applicable" is a resolution, not a pending
 * state — see badgeWithCoverage in renderHtml.ts and the audit page for the corresponding
 * "Not applicable" (coverage.total === 0) render branch, distinct from "Not yet rated"
 * (coverage.rated === 0 but total > 0).
 */
export function computeSeverityRollup(findings: FindingForRollup[]): RollupResult {
  const byTier: Record<Tier, Severity[]> = { A: [], B: [], C: [] };
  const totalByTier: Record<Tier, number> = { A: 0, B: 0, C: 0 };
  const provisionalByTier: Record<Tier, number> = { A: 0, B: 0, C: 0 };
  for (const f of findings) {
    if (f.status === "NOT_APPLICABLE") continue;
    totalByTier[f.templateItem.tier]++;
    if (f.severity) {
      byTier[f.templateItem.tier].push(f.severity);
      // Counted only where a severity exists: an IN_PROGRESS finding with no severity is simply
      // unrated, which `rated` already says, and calling it provisional would double-report it.
      if (f.status === "IN_PROGRESS") provisionalByTier[f.templateItem.tier]++;
    }
  }

  const perTier: Record<Tier, Severity> = {
    A: worstSeverity(byTier.A),
    B: worstSeverity(byTier.B),
    C: worstSeverity(byTier.C),
  };

  const perTierCoverage: Record<Tier, Coverage> = {
    A: { rated: byTier.A.length, total: totalByTier.A, provisional: provisionalByTier.A },
    B: { rated: byTier.B.length, total: totalByTier.B, provisional: provisionalByTier.B },
    C: { rated: byTier.C.length, total: totalByTier.C, provisional: provisionalByTier.C },
  };

  return {
    perTier,
    overall: worstSeverity(Object.values(perTier)),
    perTierCoverage,
    overallCoverage: {
      rated: byTier.A.length + byTier.B.length + byTier.C.length,
      total: totalByTier.A + totalByTier.B + totalByTier.C,
      provisional: provisionalByTier.A + provisionalByTier.B + provisionalByTier.C,
    },
  };
}
