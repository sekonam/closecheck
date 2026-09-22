-- What this firm recorded about a vendor, per checklist item, per engagement.
--
-- TENANT-OWNED. Template content is product-owned and shared across every consultant; this is
-- derived from one firm's clients' executed contracts, so it carries orgId and an RLS policy like
-- every other tenant table (docs/spec.md §8). Getting this wrong would leak one consultant's
-- reading of a client's contract terms to another — the failure §8 calls catastrophic rather than
-- merely competitive.
--
-- One row per ENGAGEMENT rather than one per vendor. With a single row per vendor, the deal being
-- audited overwrites the very reading it should be compared against, so the recall disappears at
-- the moment the consultant records their own answer — which is exactly when the comparison
-- becomes useful. A reading per engagement means "what we found last time" always means a
-- different deal.
CREATE TABLE "vendor_term_profiles" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "itemTitle" TEXT NOT NULL,
  "vendorKey" TEXT NOT NULL,
  "vendorLabel" TEXT NOT NULL,
  "values" JSONB NOT NULL,
  "engagementId" TEXT NOT NULL,
  "sourceBusinessName" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vendor_term_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_term_profiles_org_item_vendor_engagement_key"
  ON "vendor_term_profiles"("orgId", "itemTitle", "vendorKey", "engagementId");
CREATE INDEX "vendor_term_profiles_orgId_idx" ON "vendor_term_profiles"("orgId");
CREATE INDEX "vendor_term_profiles_engagementId_idx" ON "vendor_term_profiles"("engagementId");

ALTER TABLE "vendor_term_profiles"
  ADD CONSTRAINT "vendor_term_profiles_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE from the engagement: deleting a deal removes what was learned from it. The reading is a
-- record of that engagement's documents, and retaining it past the engagement's own retention
-- would be a §8 retention hole wearing a different name.
ALTER TABLE "vendor_term_profiles"
  ADD CONSTRAINT "vendor_term_profiles_engagementId_fkey"
  FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FORCE as well as ENABLE, matching every other tenant table: without FORCE the table's owner
-- bypasses its own policy, and the migration role is the owner.
ALTER TABLE "vendor_term_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor_term_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vendor_term_profiles"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "vendor_term_profiles" TO closecheck_app;
