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
