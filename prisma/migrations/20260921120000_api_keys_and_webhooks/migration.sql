-- Phase 4 programmatic access (docs/spec.md §13): org-scoped API keys and webhook endpoints.
-- Both are tenant-owned tables and follow the standing rule from prisma/schema.prisma's header:
-- application-layer scoping (withOrgScope) AND row-level security, never just one.

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_tokenHash_key" ON "api_keys"("tokenHash");
CREATE INDEX "api_keys_orgId_idx" ON "api_keys"("orgId");
CREATE INDEX "webhook_endpoints_orgId_idx" ON "webhook_endpoints"("orgId");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, same tenant_isolation shape as every other org-owned table
-- (prisma/migrations/20260911154700_row_level_security). The default-privileges grant from
-- 20260911160500_least_privilege_app_role already gives closecheck_app CRUD on these new tables;
-- these policies are what constrain that grant to the current org's rows.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_keys"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_endpoints"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- An incoming API request carries only a bearer token — the org is not known until the key row is
-- found, so the lookup cannot go through withOrgScope. Same problem sign-in has with email lookup,
-- same solution (20260911161500_auth_lookup_role): a dedicated role that can do ONLY this one thing.
-- SELECT on api_keys for the hash lookup, and UPDATE restricted at the GRANT level to the single
-- "lastUsedAt" column — even a bug in application code using this role cannot rewrite a key's hash,
-- org, or revocation state.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'closecheck_api') THEN
    CREATE ROLE closecheck_api LOGIN PASSWORD 'closecheck_api_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE closecheck TO closecheck_api;
GRANT USAGE ON SCHEMA public TO closecheck_api;
GRANT SELECT ON "api_keys" TO closecheck_api;
GRANT UPDATE ("lastUsedAt") ON "api_keys" TO closecheck_api;

-- Default privileges (20260911160500) granted closecheck_app CRUD on these tables automatically,
-- which is intended — but they granted nothing to closecheck_api on anything else, also intended:
-- this role must never be able to read tenant data, only key rows. The policies below are scoped
-- `TO closecheck_api`; closecheck_app's access stays governed solely by tenant_isolation above.
CREATE POLICY api_key_lookup ON "api_keys"
  FOR SELECT
  TO closecheck_api
  USING (true);

CREATE POLICY api_key_touch_last_used ON "api_keys"
  FOR UPDATE
  TO closecheck_api
  USING (true)
  WITH CHECK (true);
