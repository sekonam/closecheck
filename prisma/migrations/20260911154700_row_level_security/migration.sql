-- Row-level security: the database-layer half of tenant isolation (docs/spec.md §8, §10).
--
-- The application layer (src/lib/db/scoped.ts) sets `app.current_org_id` via `set_config(...)` at
-- the start of every request that touches tenant data. These policies make that setting load-bearing
-- even if the application layer has a bug: FORCE ROW LEVEL SECURITY means even the owning role
-- (`closecheck`, which created these tables) is subject to the policy, not just other roles.
--
-- `templates` and `template_items` are deliberately excluded: they are shared, product-owned content
-- (docs/spec.md §5), not tenant data.

-- consultant_orgs is scoped by its own id, not a separate org_id column.
ALTER TABLE "consultant_orgs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultant_orgs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consultant_orgs"
  USING (id = current_setting('app.current_org_id', true))
  WITH CHECK (id = current_setting('app.current_org_id', true));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "engagements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "engagements"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audits"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "findings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "findings"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "evidence"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reports"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "client_portal_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_portal_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_portal_links"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- portal_access_log has no org_id column of its own (a client viewing a portal link is not an
-- authenticated org session) — scope it via its parent link instead. Rows are inserted by the public
-- portal-view route (Phase 3, unbuilt), not the org-scoped app connection, so this policy governs
-- reads (by a consultant checking their own access log) rather than the as-yet-unbuilt insert path.
ALTER TABLE "portal_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_access_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_access_log"
  USING (
    "linkId" IN (
      SELECT id FROM "client_portal_links"
      WHERE "orgId" = current_setting('app.current_org_id', true)
    )
  );
