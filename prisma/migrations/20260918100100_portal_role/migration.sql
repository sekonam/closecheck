-- Client Portal (spec.md §7, Phase 3): a buyer opens a magic-link URL with NO CloseCheck account and
-- NO org session — there is no `app.current_org_id` to scope by, the same bootstrap shape as signup
-- but for reads instead of a single insert. The row_level_security migration's comment on
-- portal_access_log already anticipated this: "Rows are inserted by the public portal-view route
-- (Phase 3, unbuilt), not the org-scoped app connection."
--
-- Design: the token itself is the credential, not org membership, so scope every policy by the
-- SPECIFIC token the request presented rather than by org — mirroring withOrgScope
-- (src/lib/db/scoped.ts), which sets `app.current_org_id` per-transaction, this sets
-- `app.portal_token` per-transaction (see src/lib/portal/db.ts's withPortalScope). That means even a
-- future application bug that does an unfiltered findMany() on these tables still only ever gets back
-- rows tied to the one token already presented in this request — not every org's portal links.
--
-- Expiry and revocation are enforced INSIDE the policies below, not just in application code: a
-- revoked or expired link's report becomes genuinely unreadable at the database layer the instant
-- revokedAt/expiresAt say so, regardless of whether every call site remembers to check.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'closecheck_portal') THEN
    CREATE ROLE closecheck_portal LOGIN PASSWORD 'closecheck_portal_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE closecheck TO closecheck_portal;
GRANT USAGE ON SCHEMA public TO closecheck_portal;
GRANT SELECT ON "client_portal_links", "reports" TO closecheck_portal;
GRANT INSERT ON "portal_access_log" TO closecheck_portal;

-- Only the live, non-revoked, non-expired link matching the presented token is visible at all.
CREATE POLICY portal_token_select ON "client_portal_links"
  FOR SELECT
  TO closecheck_portal
  USING (
    token = current_setting('app.portal_token', true)
    AND "revokedAt" IS NULL
    AND "expiresAt" > now()
  );

-- A Report is visible to the portal role only if it's the exact report a live link (same token
-- check as above) points at — not "any report in that link's org," which would defeat the point of a
-- link scoping access to one Report version (spec.md §7).
CREATE POLICY portal_token_select ON "reports"
  FOR SELECT
  TO closecheck_portal
  USING (
    id IN (
      SELECT "reportId" FROM "client_portal_links"
      WHERE token = current_setting('app.portal_token', true)
        AND "revokedAt" IS NULL
        AND "expiresAt" > now()
    )
  );

-- Logging a view is only allowed against the link the presented token actually resolves to — this
-- role can never log (or, since there's no SELECT grant, even see) an access entry for any other link.
CREATE POLICY portal_token_insert ON "portal_access_log"
  FOR INSERT
  TO closecheck_portal
  WITH CHECK (
    "linkId" IN (
      SELECT id FROM "client_portal_links"
      WHERE token = current_setting('app.portal_token', true)
    )
  );
