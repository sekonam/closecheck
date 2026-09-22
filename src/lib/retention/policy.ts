/**
 * When an engagement's uploaded documents stop being kept.
 *
 * Lives in its own module rather than beside the server action that applies it, because a
 * "use server" file may only export async functions — and this policy is worth unit-testing and
 * worth reading on its own.
 */

import { DealStage } from "@prisma/client";

/**
 * Deal stages after which an engagement's uploaded documents have no further purpose.
 *
 * docs/spec.md §8 calls uploaded Tier B documents "the most sensitive data at rest" and requires
 * retention tied to the engagement lifecycle with "no indefinite default retention". The stages
 * below are where that lifecycle ends — the deal completed, or it died.
 */
export const TERMINAL_DEAL_STAGES: DealStage[] = [DealStage.CLOSED, DealStage.DEAD];

/**
 * How long documents survive after a deal reaches a terminal stage, when the consultant hasn't set
 * their own date.
 *
 * A default, not a policy: the consultant can move it either way on the engagement form, which is
 * the "consultant-configurable deletion policy" half of §8. Ninety days is long enough to cover
 * post-close questions and a dispute window, and short enough that a dead deal's contracts and
 * merchant statements aren't still sitting in the system a year later for a business that was
 * never even acquired.
 */
export const DEFAULT_POST_CLOSE_RETENTION_DAYS = 90;

export function defaultPurgeDateFor(stage: DealStage, now: Date): Date | null {
  if (!TERMINAL_DEAL_STAGES.includes(stage)) return null;
  const purgeAt = new Date(now);
  purgeAt.setUTCDate(purgeAt.getUTCDate() + DEFAULT_POST_CLOSE_RETENTION_DAYS);
  return purgeAt;
}

/**
 * The purge date an engagement should carry after an edit.
 *
 * Stated in terms of the stage the engagement is IN, not the transition it just made. An earlier
 * version keyed on the transition — default a date only when *entering* a terminal stage — which
 * left two holes and opened a third:
 *
 *   - every engagement already CLOSED or DEAD when that shipped kept indefinite retention, which
 *     is exactly the population it was written for;
 *   - CLOSED → DEAD is terminal-to-terminal, so it wrote null and retained indefinitely;
 *   - worst, a revived deal kept its date. DEAD (auto-filled) → POST_LOI re-submitted the stored
 *     value from the prefilled input, nothing cleared it, and the purge job selects on the date
 *     alone — so on day 90 it would delete the seller's contracts out of a live diligence
 *     engagement, from a date the consultant never typed.
 *
 * The rule: a terminal engagement always has a purge date, a live one never does. A consultant who
 * wants longer than the default sets a later date. A consultant who clears it on a closed deal
 * gets the default back, because indefinite retention of a dead deal's documents is the thing
 * spec.md §8 rules out, not a preference to honour.
 */
export function resolvePurgeDate(params: {
  targetStage: DealStage;
  /** A date the consultant typed in this submission, if any. */
  submitted: Date | null;
  /** What the engagement currently carries. */
  existing: Date | null;
  now: Date;
}): Date | null {
  if (!TERMINAL_DEAL_STAGES.includes(params.targetStage)) return null;
  return params.submitted ?? params.existing ?? defaultPurgeDateFor(params.targetStage, params.now);
}

/**
 * What a retention run covers, beyond the uploaded documents themselves.
 *
 * THE PROBLEM THIS ANSWERS
 * ------------------------
 * A generated report is the densest concentration of derived confidential content in the system:
 * findings taken from the seller's documents, structured values read out of their contracts, and —
 * since citations — clauses quoted verbatim from them. Purging the documents while keeping the
 * report retains the substance of what was purged, which is the same failure as a cache outliving
 * the record it caches.
 *
 * It also produced a false statement in a document the buyer still holds. The report's appendix
 * said the firm "can provide any of them on request"; after the engagement's documents were purged
 * that was no longer true, and nothing updated the document that said it.
 *
 * THE DECISION
 * ------------
 * On a retention run, an engagement's report PDFs are deleted and its live portal links revoked,
 * alongside its evidence. The Report ROW survives, with its severity and coverage snapshot.
 *
 * That split is the point. The consultant keeps a durable record that they issued a report with a
 * given rating on a given date — which is what their own liability position actually needs — while
 * the seller's derived content does not outlive the seller's documents. Keeping the row also means
 * the audit trail of what was issued, to whom, and when remains intact after the content is gone.
 *
 * Portal links are revoked rather than left to expire because a live link serving a report whose
 * source documents have been purged is worse than either outcome on its own: it is the product
 * continuing to distribute derived content it has just promised to stop holding.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * Nothing recalls the copy the buyer already downloaded. Retention governs what this product
 * holds, not what has been handed over — and a policy that implied otherwise would be the same
 * class of false assurance as the appendix line it replaces.
 */
export type RetentionScope = {
  /** Uploaded Tier B/C documents. */
  evidence: true;
  /** Generated report PDFs — the derived content. The Report rows themselves are kept. */
  reportPdfs: true;
  /** Live Client Portal Links, revoked so nothing keeps serving what was just purged. */
  portalLinks: true;
};

export const RETENTION_SCOPE: RetentionScope = {
  evidence: true,
  reportPdfs: true,
  portalLinks: true,
};

/**
 * The sentence the report's appendix uses to describe how long the listed documents are available.
 *
 * Lives here rather than in the renderer because it is a statement about the retention policy, and
 * the two drifting apart is precisely what went wrong: the renderer promised availability "on
 * request" with no end, while the policy deleted the documents on a schedule the renderer knew
 * nothing about.
 */
export function appendixRetentionSentence(purgeAt: Date | null): string {
  const base =
    "Documents provided as evidence during this audit, listed for reference. They are held and " +
    "access-controlled under the firm's document retention policy and are not reproduced here.";
  if (!purgeAt) {
    return `${base} Ask the firm if you need a copy of any of them.`;
  }
  return (
    `${base} They are scheduled for deletion on ${purgeAt.toISOString().slice(0, 10)}; ` +
    "request any copies you need before then."
  );
}
