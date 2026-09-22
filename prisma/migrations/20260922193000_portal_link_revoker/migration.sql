-- Records which seat revoked a Client Portal Link.
--
-- `revokedAt` recorded that a link was pulled back and not by whom, while `createdById` recorded
-- who sent it. So the access trail could name the seat that took a deliverable outside the firm,
-- and not the seat that took it away from a client mid-engagement.
--
-- docs/spec.md §12 carries an open question on whether a Member may revoke a link they did not
-- create, and deliberately defers it until a firm hits it on a live engagement. The harm that
-- question names is a colleague's delivery being destroyed "possibly without their knowing" — which
-- a firm cannot report back, and therefore cannot be gathered as evidence, while the trail reads
-- "Revoked · <timestamp>" and stops. This column does not decide who may act. It makes the
-- deferral's own exit condition reachable.
--
-- Nullable with no backfill: links revoked before this shipped have no recoverable actor, and
-- inventing one would put a name in an audit trail that nothing supports.
ALTER TABLE "client_portal_links" ADD COLUMN "revokedById" TEXT;

-- ON DELETE SET NULL, matching createdById: the trail must outlive the person. The index is not
-- optional bookkeeping — SET NULL scans this table whenever a user row is deleted.
CREATE INDEX "client_portal_links_revokedById_idx" ON "client_portal_links"("revokedById");

ALTER TABLE "client_portal_links" ADD CONSTRAINT "client_portal_links_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
