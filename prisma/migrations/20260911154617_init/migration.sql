-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('PRE_LOI', 'POST_LOI', 'CLOSING', 'CLOSED', 'DEAD');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "CheckMethod" AS ENUM ('AUTOMATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PASS', 'FAIL', 'NOT_APPLICABLE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('DOCUMENT', 'NOTE', 'SCREENSHOT');

-- CreateTable
CREATE TABLE "consultant_orgs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandLogoUrl" TEXT,
    "brandColorHex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultant_orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagements" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "dealStage" "DealStage" NOT NULL DEFAULT 'PRE_LOI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "documentPurgeAt" TIMESTAMP(3),

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "method" "CheckMethod" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "automationKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "overallRatingOverride" "Severity",
    "overallRatingOverrideNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "templateItemId" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "severity" "Severity",
    "note" TEXT,
    "structuredData" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "storageKey" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "computedOverallSeverity" "Severity" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfStorageKey" TEXT,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_portal_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_access_log" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,

    CONSTRAINT "portal_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_orgId_idx" ON "users"("orgId");

-- CreateIndex
CREATE INDEX "engagements_orgId_idx" ON "engagements"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "templates_slug_version_key" ON "templates"("slug", "version");

-- CreateIndex
CREATE INDEX "template_items_templateId_idx" ON "template_items"("templateId");

-- CreateIndex
CREATE INDEX "audits_orgId_idx" ON "audits"("orgId");

-- CreateIndex
CREATE INDEX "audits_engagementId_idx" ON "audits"("engagementId");

-- CreateIndex
CREATE INDEX "findings_orgId_idx" ON "findings"("orgId");

-- CreateIndex
CREATE INDEX "findings_auditId_idx" ON "findings"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "findings_auditId_templateItemId_key" ON "findings"("auditId", "templateItemId");

-- CreateIndex
CREATE INDEX "evidence_orgId_idx" ON "evidence"("orgId");

-- CreateIndex
CREATE INDEX "evidence_findingId_idx" ON "evidence"("findingId");

-- CreateIndex
CREATE INDEX "reports_orgId_idx" ON "reports"("orgId");

-- CreateIndex
CREATE INDEX "reports_auditId_idx" ON "reports"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_links_token_key" ON "client_portal_links"("token");

-- CreateIndex
CREATE INDEX "client_portal_links_orgId_idx" ON "client_portal_links"("orgId");

-- CreateIndex
CREATE INDEX "portal_access_log_linkId_idx" ON "portal_access_log"("linkId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_items" ADD CONSTRAINT "template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "template_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_links" ADD CONSTRAINT "client_portal_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_links" ADD CONSTRAINT "client_portal_links_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_log" ADD CONSTRAINT "portal_access_log_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "client_portal_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
