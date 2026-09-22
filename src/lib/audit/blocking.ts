/**
 * Which checklist items a consultant can actually run at the deal stage they're at.
 *
 * docs/spec.md §2.3 calls the tier boundaries "load-bearing, not cosmetic", and says why: "a
 * consultant needs to know exactly what they can run *before* an LOI vs. what requires seller
 * cooperation they may not have yet." §4 then declares a blocking dependency as a property every
 * checklist item carries. Template v3 finally records it (`TemplateItem.blockingDependency`); this
 * is the half that turns it into something the consultant sees.
 *
 * The distinction matters commercially, not just organisationally: Tier A is the pre-LOI surface a
 * consultant can run on a prospect before they're even engaged, and mixing items they cannot start
 * into that view makes an audit look stalled when it is simply early.
 *
 * ADVISORY, NEVER ENFORCED. Deals do not read the playbook — a cooperative broker hands over
 * contracts pre-LOI more often than the tidy model suggests, and a consultant who has the document
 * must be able to record the finding whatever stage the engagement is nominally at. So this labels;
 * it never disables an input or refuses a save.
 */

import { BlockingDependency, DealStage } from "@prisma/client";

/** Deal stages in the order they occur, so "have we reached X yet" is a comparison. */
const STAGE_ORDER: DealStage[] = [
  DealStage.PRE_LOI,
  DealStage.POST_LOI,
  DealStage.CLOSING,
  DealStage.CLOSED,
  DealStage.DEAD,
];

/**
 * The stage at which each dependency is typically satisfiable, per spec.md §4's tier descriptions:
 * Tier B documents are "typically available once diligence has formally started (post-LOI in most
 * deals, sometimes earlier if broker is cooperative)", and Tier C live access is "often deferred
 * until very late pre-close or handled at closing itself".
 */
const SATISFIED_FROM: Record<BlockingDependency, DealStage | null> = {
  [BlockingDependency.NONE]: null,
  [BlockingDependency.SELLER_DOCUMENTS]: DealStage.POST_LOI,
  [BlockingDependency.LIVE_ACCESS]: DealStage.CLOSING,
};

export const BLOCKING_LABEL: Record<BlockingDependency, string> = {
  [BlockingDependency.NONE]: "Runnable now",
  [BlockingDependency.SELLER_DOCUMENTS]: "Needs seller documents",
  [BlockingDependency.LIVE_ACCESS]: "Needs live access",
};

/**
 * Is this item one the consultant probably cannot start yet at the engagement's current stage?
 *
 * DEAD and CLOSED are deliberately NOT treated as blocking. A closed deal's audit is being written
 * up, not run, and a dead deal's is being recorded for the file — flagging every item as "not yet
 * available" on an engagement that has already ended would be nonsense.
 */
export function isLikelyUnavailable(dependency: BlockingDependency, stage: DealStage): boolean {
  const satisfiedFrom = SATISFIED_FROM[dependency];
  if (!satisfiedFrom) return false;
  if (stage === DealStage.CLOSED || stage === DealStage.DEAD) return false;
  return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(satisfiedFrom);
}

/** Consultant-facing explanation of why an item isn't available yet, or null when it is. */
export function unavailableReason(dependency: BlockingDependency, stage: DealStage): string | null {
  if (!isLikelyUnavailable(dependency, stage)) return null;
  return dependency === BlockingDependency.SELLER_DOCUMENTS
    ? "Usually needs the seller or broker to hand over documents, which typically happens once diligence formally starts. Record it as Blocked if you've asked and not received them."
    : "Usually needs live access to a seller-controlled system, which is normally arranged late in the process. Record it as Blocked if the seller won't schedule it.";
}
