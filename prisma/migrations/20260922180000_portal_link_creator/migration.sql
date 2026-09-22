-- Which seat sent a report to the outside world.
--
-- Creating a portal link is engagement-scoped work that any seat may do, because delivering the
-- deliverable is the job. But it is the one such action with outward blast radius, and "any seat
-- may do it" and "nobody can tell who did" must not both be true — the firm could previously see
-- that a report went to an outside party, and who viewed it, but not which of its own people sent
-- it. The spec.md §8 trail stopped at the firm boundary in the one place it mattered.
--
-- Nullable: every link created before this column existed has no answer, and attributing them to
-- anyone would be inventing a fact about who shared a client's report.
ALTER TABLE "client_portal_links" ADD COLUMN "createdById" TEXT;

-- ON DELETE SET NULL, like evidence.uploadedById. The link must outlive the person who sent it: a
-- cascade would erase the access history of a report that had already been shared with a buyer,
-- at exactly the moment a firm reorganises.
ALTER TABLE "client_portal_links"
  ADD CONSTRAINT "client_portal_links_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "client_portal_links_createdById_idx" ON "client_portal_links"("createdById");
