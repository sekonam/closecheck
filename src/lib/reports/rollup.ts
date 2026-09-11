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
  templateItem: { tier: Tier };
}

export interface RollupResult {
  perTier: Record<Tier, Severity>;
  overall: Severity;
}

/** Overall = worst tier rating; each tier's rating = worst finding rating within that tier. */
export function computeSeverityRollup(findings: FindingForRollup[]): RollupResult {
  const byTier: Record<Tier, Severity[]> = { A: [], B: [], C: [] };
  for (const f of findings) {
    if (f.severity) byTier[f.templateItem.tier].push(f.severity);
  }

  const perTier: Record<Tier, Severity> = {
    A: worstSeverity(byTier.A),
    B: worstSeverity(byTier.B),
    C: worstSeverity(byTier.C),
  };

  return {
    perTier,
    overall: worstSeverity(Object.values(perTier)),
  };
}
