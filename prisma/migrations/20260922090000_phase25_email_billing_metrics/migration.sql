-- Phase 2.5 revenue readiness (docs/roadmap.md Phase 2.5): transactional-email log, billing
-- (Stripe-linked account + append-only audit-credit ledger), and product telemetry
-- (metrics/error events). Tenant-owned tables follow the standing two-layer rule
-- (withOrgScope + RLS); the two telemetry tables are deliberately NOT org-readable — see below.

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED', 'LOGGED');
CREATE TYPE "BillingPlan" AS ENUM ('SOLO_MONTHLY', 'SOLO_ANNUAL', 'TEAM_MONTHLY', 'TEAM_ANNUAL');
CREATE TYPE "BillingStatus" AS ENUM ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED');
CREATE TYPE "CreditReason" AS ENUM ('PLAN_GRANT', 'AUDIT_CONSUMED', 'OVERAGE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "plan" "BillingPlan",
    "status" "BillingStatus" NOT NULL DEFAULT 'NONE',
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_credit_ledger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "CreditReason" NOT NULL,
    "auditId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_credit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metric_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_messages_orgId_idx" ON "email_messages"("orgId");
CREATE UNIQUE INDEX "billing_accounts_orgId_key" ON "billing_accounts"("orgId");
CREATE UNIQUE INDEX "billing_accounts_stripeCustomerId_key" ON "billing_accounts"("stripeCustomerId");
CREATE INDEX "audit_credit_ledger_orgId_idx" ON "audit_credit_ledger"("orgId");
CREATE INDEX "metric_events_type_createdAt_idx" ON "metric_events"("type", "createdAt");
CREATE INDEX "error_events_createdAt_idx" ON "error_events"("createdAt");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_credit_ledger" ADD CONSTRAINT "audit_credit_ledger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant RLS, same tenant_isolation shape as every other org-owned table.
ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_messages"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "billing_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "billing_accounts"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "audit_credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_credit_ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_credit_ledger"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- Telemetry tables: product-owned, WRITE-ONLY for the app role. The default-privileges grant from
-- 20260911160500 gave closecheck_app full CRUD on these new tables automatically — revoke it down to
-- INSERT so no application code path (bug or not) can ever read events back out; rows carry org ids
-- and event names across every tenant, and the read path is scripts/metrics-report.ts via the DIRECT
-- role only. No RLS: RLS's org-scoping model doesn't fit write-only telemetry (an insert during a
-- signup has no org session yet), and the revoked SELECT is the actual isolation mechanism here.
REVOKE ALL ON "metric_events" FROM closecheck_app;
REVOKE ALL ON "error_events" FROM closecheck_app;
GRANT INSERT ON "metric_events" TO closecheck_app;
GRANT INSERT ON "error_events" TO closecheck_app;

-- The signup role fires the very first metric event ("org.signed_up") before any org session exists,
-- on the same narrow terms: insert and nothing else.
GRANT INSERT ON "metric_events" TO closecheck_signup;
GRANT INSERT ON "error_events" TO closecheck_signup;
