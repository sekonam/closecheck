-- Whitelabel brand-kit snapshot on the Report row (docs/spec.md §6).
--
-- A Report is a point-in-time document: the PDF already embeds the firm name, accent and logo that
-- were live when it was generated. The Client Portal (src/app/portal/[token]/) was wrapping that
-- fixed document in whatever branding the org row carries *today*, and reading `consultant_orgs` on
-- every buyer view to do it. These three columns let both the portal and any future re-render take
-- the branding from the Report itself.
--
-- No new RLS policy: `reports` is already a tenant table with policies for both the app role
-- (prisma/migrations/*_row_level_security) and the portal role (*_portal_role), and a policy is
-- row-scoped, not column-scoped — new columns inherit it.
--
-- No new GRANT either, and that is the thing to check rather than assume: the grants these columns
-- depend on are TABLE-level, not column-level —
--   *_least_privilege_app_role: GRANT SELECT, INSERT, UPDATE, DELETE ON ... "reports" ... TO closecheck_app
--   *_portal_role:              GRANT SELECT ON "client_portal_links", "reports" TO closecheck_portal
-- A column-level grant would NOT extend to a column added later, and the failure mode is a runtime
-- "permission denied for column" on a buyer-facing page, not a migration error. Verified after
-- applying this migration by selecting the three columns as each role.
ALTER TABLE "reports" ADD COLUMN     "brandSnapshotColorHex" TEXT,
ADD COLUMN     "brandSnapshotFirmName" TEXT,
ADD COLUMN     "brandSnapshotLogoKey" TEXT;
