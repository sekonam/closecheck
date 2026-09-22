-- Fixes a latent timezone bug in every portal-link liveness check, found live (2026-09-22) when the
-- verify-signup-portal-roles suite failed against a Postgres cluster whose timezone wasn't UTC:
--
-- Prisma writes UTC instants into TIMESTAMP(3) (timestamp WITHOUT time zone) columns, but bare
-- `now()` is timestamptz and gets rendered in the SESSION's timezone when compared against a
-- timestamp column. On a UTC server (the Docker dev DB, most managed Postgres) the comparison is
-- accidentally correct; on any non-UTC server a link's expiry is evaluated hours off — e.g. a
-- UTC+3 server treats every link as expiring 3 hours early. Liveness is a security property of the
-- portal (spec.md §7), so it must not depend on a server locale setting: compare against the UTC
-- instant explicitly.
--
-- Same three policies as 20260918100100 / 20260918110000, with `now()` → `(now() AT TIME ZONE 'utc')`.

DROP POLICY portal_token_select ON "client_portal_links";
CREATE POLICY portal_token_select ON "client_portal_links"
  FOR SELECT
  TO closecheck_portal
  USING (
    token = current_setting('app.portal_token', true)
    AND "revokedAt" IS NULL
    AND "expiresAt" > (now() AT TIME ZONE 'utc')
  );

DROP POLICY portal_token_select ON "reports";
CREATE POLICY portal_token_select ON "reports"
  FOR SELECT
  TO closecheck_portal
  USING (
    id IN (
      SELECT "reportId" FROM "client_portal_links"
      WHERE token = current_setting('app.portal_token', true)
        AND "revokedAt" IS NULL
        AND "expiresAt" > (now() AT TIME ZONE 'utc')
    )
  );

DROP POLICY portal_token_insert ON "portal_access_log";
CREATE POLICY portal_token_insert ON "portal_access_log"
  FOR INSERT
  TO closecheck_portal
  WITH CHECK (
    "linkId" IN (
      SELECT id FROM "client_portal_links"
      WHERE token = current_setting('app.portal_token', true)
        AND "revokedAt" IS NULL
        AND "expiresAt" > (now() AT TIME ZONE 'utc')
    )
  );
