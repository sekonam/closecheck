-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "overallCoveredCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overallTotalCount" INTEGER NOT NULL DEFAULT 0;
