-- The portal_token_insert policy (prisma/migrations/20260918100100_portal_role) checks that the
-- presented token resolves to SOME client_portal_links row, but — unlike the SELECT policies on the
-- same migration — never checks that row is still live (not revoked, not expired). Not currently
-- reachable through the app (src/app/portal/[token]/page.tsx already 404s before logging a view
-- against a dead link, via the SELECT policy above rejecting it first), but that migration's own
-- stated design goal was for expiry/revocation to hold "regardless of whether every call site
-- remembers to check" — this INSERT policy didn't actually live up to that. Tightening it here so a
-- future code path can't log an access entry against a link that should already be inert.
DROP POLICY portal_token_insert ON "portal_access_log";

CREATE POLICY portal_token_insert ON "portal_access_log"
  FOR INSERT
  TO closecheck_portal
  WITH CHECK (
    "linkId" IN (
      SELECT id FROM "client_portal_links"
      WHERE token = current_setting('app.portal_token', true)
        AND "revokedAt" IS NULL
        AND "expiresAt" > now()
    )
  );
