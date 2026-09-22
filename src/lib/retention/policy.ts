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
