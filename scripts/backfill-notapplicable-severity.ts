/**
 * One-off backfill: clear the severity on findings marked NOT_APPLICABLE.
 *
 * Status and severity are separate fields on one form, so rating an item Red and later switching
 * its status to NOT APPLICABLE — having learned the business has no such system — left the stale
 * Red persisted. `updateFinding` now normalises the two so they can never be stored together, but
 * rows written before that keep the contradiction, and nothing rewrites them.
 *
 * It matters because the severity roll-up excludes NOT_APPLICABLE findings from both the rating
 * and the coverage count. So such a row reads as Red in any surface that renders `severity`
 * directly while the tier header above it reads Green — a visible self-contradiction in a document
 * handed to a buyer, and a contradictory pair emitted to anyone reading the API.
 *
 * Idempotent and narrow: only touches rows where status is NOT_APPLICABLE and severity is set.
 *
 * Runs against DIRECT_DATABASE_URL, deliberately — this is a cross-tenant administrative fix and
 * the app role's RLS is scoped to one org at a time by design.
 *
 *     DIRECT_DATABASE_URL=... npm run db:backfill-notapplicable-severity -- --apply
 *
 * Without --apply it reports what it would change and writes nothing.
 */

import { PrismaClient } from "@prisma/client";

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_DATABASE_URL must be set — this backfill runs across every tenant.");
}

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  const contradictory = await prisma.finding.findMany({
    where: { status: "NOT_APPLICABLE", severity: { not: null } },
    select: {
      id: true,
      severity: true,
      orgId: true,
      templateItem: { select: { title: true } },
      audit: { select: { engagement: { select: { businessName: true } } } },
    },
  });

  if (contradictory.length === 0) {
    console.log("No not-applicable findings are carrying a severity. Nothing to do.");
    return;
  }

  console.log(`${contradictory.length} not-applicable finding(s) still carry a severity:`);
  for (const finding of contradictory) {
    console.log(
      `  [${finding.severity}] ${finding.templateItem.title} — ${finding.audit.engagement.businessName}`,
    );
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to clear these.");
    return;
  }

  const result = await prisma.finding.updateMany({
    where: { status: "NOT_APPLICABLE", severity: { not: null } },
    data: { severity: null },
  });
  console.log(`\nCleared the severity on ${result.count} finding(s).`);

  // Reports already generated keep their stored snapshot, which is correct: a report is a
  // point-in-time document and must not change retroactively because the underlying audit was
  // corrected. Re-generate a report if its contradictory row needs to disappear from it.
  console.log(
    "Existing reports keep their snapshot and are unchanged — regenerate one if it needs to reflect this.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
