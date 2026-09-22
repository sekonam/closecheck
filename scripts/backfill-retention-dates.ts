/**
 * One-off backfill: give every already-terminal engagement a document purge date.
 *
 * docs/spec.md §8 requires "no indefinite default retention", and `updateEngagement` now enforces
 * that going forward — but only when an engagement is saved. An engagement that reached CLOSED or
 * DEAD before this shipped, and that nobody edits again, keeps indefinite retention forever. That
 * is precisely the population the rule exists for: a dead deal nobody is touching, whose seller's
 * contracts and merchant statements are still sitting in the system.
 *
 * Idempotent: only fills a null date, never moves one a consultant set. Safe to re-run.
 *
 * Runs against DIRECT_DATABASE_URL rather than the app role, deliberately — this is a
 * cross-tenant administrative operation, and the app role's RLS is scoped to one org at a time by
 * design. That makes this a script a founder runs once, not something the application can do.
 *
 *     DIRECT_DATABASE_URL=... npm run db:backfill-retention-dates -- --apply
 *
 * Without --apply it reports what it would change and writes nothing.
 */

import { PrismaClient } from "@prisma/client";

import { TERMINAL_DEAL_STAGES, defaultPurgeDateFor } from "../src/lib/retention/policy";

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_DATABASE_URL must be set — this backfill runs across every tenant.");
}

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  const now = new Date();
  const stranded = await prisma.engagement.findMany({
    where: { dealStage: { in: TERMINAL_DEAL_STAGES }, documentPurgeAt: null },
    select: { id: true, orgId: true, businessName: true, dealStage: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });

  if (stranded.length === 0) {
    console.log("No terminal engagements are missing a purge date. Nothing to do.");
    return;
  }

  console.log(
    `${stranded.length} terminal engagement(s) have no purge date and would retain documents indefinitely:`,
  );
  for (const engagement of stranded) {
    const purgeAt = defaultPurgeDateFor(engagement.dealStage, now);
    console.log(
      `  ${engagement.businessName} (${engagement.dealStage}, last touched ${engagement.updatedAt
        .toISOString()
        .slice(0, 10)}) → purge ${purgeAt?.toISOString().slice(0, 10)}`,
    );
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write these dates.");
    return;
  }

  // One update per row rather than a bulk updateMany: the default is computed per engagement from
  // its own stage, and a per-row loop keeps that honest if the stages ever diverge in their
  // retention windows.
  let written = 0;
  for (const engagement of stranded) {
    const purgeAt = defaultPurgeDateFor(engagement.dealStage, now);
    if (!purgeAt) continue;
    // Guarded on documentPurgeAt still being null, so a consultant who set a date between the read
    // above and this write keeps theirs.
    const result = await prisma.engagement.updateMany({
      where: { id: engagement.id, documentPurgeAt: null },
      data: { documentPurgeAt: purgeAt },
    });
    written += result.count;
  }

  console.log(`\nWrote a purge date to ${written} engagement(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
