import type { Prisma } from "@prisma/client";

/**
 * Withdraws a Client Portal Link, recording which seat did it.
 *
 * WHY THIS IS ATTRIBUTED
 * ----------------------
 * Revocation used to write a bare `revokedAt`. Creation has recorded `createdById` since the trail
 * was extended to the firm boundary, so the access history could name the seat that sent a report
 * to an outside party and not the seat that took it back from them.
 *
 * docs/spec.md §12 carries an open question on whether a Member may revoke a link they did not
 * create, and defers it deliberately: both readings are defensible, and the resolution waits on a
 * firm hitting it on a live engagement rather than on a guess about which failure is worse. That
 * deferral is right, and this function does not touch it — any seat may still revoke, because
 * revocation is engagement-scoped like the sharing it undoes.
 *
 * What it does fix is that the deferral could not be reached. The harm the question names is a
 * colleague's delivery destroyed "possibly without their knowing", and a firm looking at
 * "Revoked · <timestamp>" has nothing to escalate with, so the evidence the decision waits on could
 * never arrive. Recording the actor is what makes waiting for evidence a strategy rather than a way
 * of never deciding.
 *
 * WHY IT IS IDEMPOTENT
 * --------------------
 * A second revocation used to overwrite `revokedAt` with a later timestamp, which was untidy while
 * nothing read it and is wrong now that something does: the trail would name whoever last pressed
 * the button on an already-dead link and date the withdrawal to that moment. The first revocation
 * is the event — it is the one that stopped the buyer reading the report. Re-revoking is a no-op
 * that reports the same link, matching revokeApiKey.
 *
 * Takes the transaction client so the read, the guard and the write share one RLS-scoped
 * transaction: another firm's link resolves to zero rows under this scope, which is why a missing
 * link is "not found" rather than a Postgres error.
 */
export async function revokePortalLink(
  tx: Prisma.TransactionClient,
  linkId: string,
  userId: string,
): Promise<{ engagementId: string; auditId: string }> {
  const link = await tx.clientPortalLink.findUnique({
    where: { id: linkId },
    include: { report: { include: { audit: true } } },
  });
  if (!link) {
    throw new Error("Link not found.");
  }

  const route = { engagementId: link.report.audit.engagementId, auditId: link.report.auditId };
  if (link.revokedAt) {
    return route; // Already withdrawn. The first revocation is the record; leave it alone.
  }

  await tx.clientPortalLink.update({
    where: { id: linkId },
    data: { revokedAt: new Date(), revokedById: userId },
  });
  return route;
}
