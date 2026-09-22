import type { Prisma } from "@prisma/client";

/**
 * Refuses an action unless the caller owns the account.
 *
 * WHICH ACTIONS, AND WHY
 * ----------------------
 * The line is scope, not seniority: does the action belong to an *engagement*, or to the *firm*?
 *
 * A Team plan exists so a firm's consultants can share engagements (docs/spec.md §5), so a seat
 * that cannot take an audit, attach evidence or issue a report is a seat that cannot do the thing
 * it is sold for. Engagement-scoped work is open to every seat, and a colleague correcting another
 * colleague's finding in a three-person firm needs an audit trail rather than a permission wall —
 * blocking it would make a partner the bottleneck on every correction.
 *
 * Firm-scoped changes are different. They alter what the firm IS rather than what one deal says:
 * billing and plan, seats and team membership, API keys, webhook endpoints, the brand kit on every
 * report the firm has ever issued, and the acknowledgement of the report's liability language on
 * the firm's behalf.
 *
 * WHY THIS EXISTS AS A HELPER
 * ---------------------------
 * The check was written inline in three places and simply absent from four others, so the settings
 * page told users "Only the account owner can invite or remove teammates" while any member could
 * change the firm's name, colour and logo on every deliverable it had ever produced — the product
 * asserting a role model in copy that no data path read. One helper makes the omission visible: an
 * action that does not call it is making a claim that it is engagement-scoped.
 *
 * Takes the transaction client so the role is read INSIDE the caller's own scoped transaction —
 * the role must come from the same RLS-scoped view as everything else the action touches, never
 * from the session token, which is issued once and would not notice a demotion.
 */
export async function requireOwner(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
): Promise<void> {
  const caller = await tx.user.findUnique({ where: { id: userId } });
  if (!caller) {
    throw new Error("Your account could not be found.");
  }
  if (caller.role !== "OWNER") {
    throw new Error(`Only the account owner can ${action}.`);
  }
}
