-- CreateEnum
CREATE TYPE "EvidenceExpectation" AS ENUM ('NONE', 'DOCUMENT', 'ATTESTATION');

-- CreateEnum
CREATE TYPE "BlockingDependency" AS ENUM ('NONE', 'SELLER_DOCUMENTS', 'LIVE_ACCESS');

-- AlterTable
ALTER TABLE "template_items" ADD COLUMN     "blockingDependency" "BlockingDependency" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "evidenceExpectation" "EvidenceExpectation" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "fieldSchema" JSONB,
ADD COLUMN     "guidance" TEXT,
ADD COLUMN     "severityGuidance" TEXT;

-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "changeNote" TEXT;

-- At most one active version per template slug.
--
-- `createAudit` resolves a template with `findFirst({ where: { slug, isActive: true } })`. With no
-- constraint, two active rows for the same slug are representable and that query silently picks
-- one — meaning two audits started minutes apart could run different checklists while both
-- claiming the same template. Publishing (src/lib/templates/publish.ts) already deactivates the
-- previous version inside a transaction before inserting the new one, so this index makes an
-- invariant the code already maintains impossible to violate by hand, by a future script, or by a
-- partially-applied publish. Expressed as raw SQL because Prisma cannot declare partial indexes.
CREATE UNIQUE INDEX "templates_slug_active_key" ON "templates" ("slug") WHERE "isActive";
