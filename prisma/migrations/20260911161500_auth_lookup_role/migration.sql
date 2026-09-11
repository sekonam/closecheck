-- Signing in has to look a user up by email BEFORE an org is known — that's exactly what the lookup
-- establishes — so it cannot go through withOrgScope like every other query (src/lib/db/scoped.ts).
-- Confirmed locally: after the previous migration made RLS actually enforce (closecheck_app is no
-- longer a superuser), sign-in broke with CredentialsSignin because the org-scoped policy on `users`
-- correctly denied the unscoped lookup. That is RLS working as intended, not a bug to route around
-- with a broader grant on `closecheck_app` — widening that role's access to all users across all
-- orgs would leak every org's user list (and password hashes) to every other org's queries the
-- moment any code forgets to scope, which is the exact failure mode RLS exists to prevent.
--
-- Instead: a role that can ONLY do this one thing. No grants on any table but `users`, and even
-- there only SELECT — it cannot list engagements, audits, findings, or anything else, regardless of
-- how it's used. src/lib/auth/db.ts is the one place this role's connection string is used.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'closecheck_auth') THEN
    CREATE ROLE closecheck_auth LOGIN PASSWORD 'closecheck_auth_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE closecheck TO closecheck_auth;
GRANT USAGE ON SCHEMA public TO closecheck_auth;
GRANT SELECT ON "users" TO closecheck_auth;

-- `TO closecheck_auth` scopes this policy to that role only — closecheck_app's access to `users`
-- stays governed solely by the tenant_isolation policy from the row_level_security migration.
CREATE POLICY auth_lookup_by_email ON "users"
  FOR SELECT
  TO closecheck_auth
  USING (true);
