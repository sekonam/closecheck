-- The row-level security policies added in the previous migration are silently ineffective for any
-- role with the superuser or BYPASSRLS attribute — Postgres exempts both from RLS entirely,
-- regardless of FORCE ROW LEVEL SECURITY (see Postgres docs on row security). The bootstrap role
-- created by the official postgres Docker image (POSTGRES_USER, "closecheck" here) IS a superuser.
-- Verified locally with scripts/verify-rls.ts: cross-tenant data was fully visible until this role
-- existed and the app switched to using it — this was a real bug, not a hypothetical one, and is
-- exactly the kind of thing .claude/skills/domain-code-review/SKILL.md's RLS checklist item exists
-- to catch. Do not run the application against a superuser/BYPASSRLS role in ANY environment.
--
-- This migration itself still runs via the superuser role (DIRECT_DATABASE_URL) — creating a role
-- and granting privileges requires elevated rights. The generated Prisma Client / running app must
-- use DATABASE_URL pointed at `closecheck_app` instead, per .env.example.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'closecheck_app') THEN
    CREATE ROLE closecheck_app LOGIN PASSWORD 'closecheck_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE closecheck TO closecheck_app;
GRANT USAGE ON SCHEMA public TO closecheck_app;

-- Full CRUD on tenant-owned tables — RLS policies (previous migration) constrain which ROWS within
-- these grants are actually visible/writable; this grant alone does not bypass that.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "consultant_orgs", "users", "engagements", "audits", "findings", "evidence",
  "reports", "client_portal_links", "portal_access_log"
TO closecheck_app;

-- Templates/template_items are shared, non-tenant content (docs/spec.md §5) — read-only for the app
-- role. Nothing in the application ever writes these at runtime; seeding runs via the superuser role.
GRANT SELECT ON "templates", "template_items" TO closecheck_app;

-- Ensures tables created by future migrations (still run as the superuser) are automatically granted
-- to closecheck_app without a manual GRANT added to every migration that adds a table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO closecheck_app;
