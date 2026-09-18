-- Self-serve signup (Phase 2, roadmap.md) needs to create the FIRST row of a brand-new
-- ConsultantOrg + its owner User — the same bootstrap problem prisma/seed.ts solves by connecting as
-- the superuser (DIRECT_DATABASE_URL). That's not an option for a public, unauthenticated runtime
-- path: it would hand every visitor of /signup a connection that can read and write every table in
-- the database. Instead, a role scoped to exactly this one operation, same philosophy as
-- closecheck_auth (20260911161500_auth_lookup_role) and closecheck_portal (below): INSERT-only, on
-- exactly two tables, nothing else — it cannot SELECT, UPDATE, or DELETE anything, including the row
-- it just created (Prisma's create()/INSERT ... RETURNING does not require a separate SELECT grant).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'closecheck_signup') THEN
    CREATE ROLE closecheck_signup LOGIN PASSWORD 'closecheck_signup_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE closecheck TO closecheck_signup;
GRANT USAGE ON SCHEMA public TO closecheck_signup;
GRANT INSERT ON "consultant_orgs", "users" TO closecheck_signup;

-- Both tables FORCE RLS (row_level_security migration), so INSERT still needs a permissive policy
-- for this role or every insert is denied regardless of the GRANT above. WITH CHECK (true): there is
-- no existing tenant boundary to check a signup against — creating the boundary is the whole point —
-- so the only real constraints are the schema's own (email UNIQUE, orgId FK), which still apply.
CREATE POLICY signup_insert ON "consultant_orgs"
  FOR INSERT
  TO closecheck_signup
  WITH CHECK (true);

CREATE POLICY signup_insert ON "users"
  FOR INSERT
  TO closecheck_signup
  WITH CHECK (true);
