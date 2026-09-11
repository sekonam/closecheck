/**
 * Enforces the document retention policy from docs/spec.md §8: uploaded Tier B evidence documents
 * are the most sensitive data at rest, and the consultant sets a purge date directly on the
 * Engagement (Engagement.documentPurgeAt — see the "Edit engagement" form on the engagement page).
 * This script does the actual deletion; nothing runs it automatically yet — wire it to a cron
 * schedule (e.g. a daily job) once this ships anywhere beyond one developer's laptop.
 *
 * Deliberately connects with DIRECT_DATABASE_URL (the superuser/migration role), not the app's
 * `closecheck_app` role: finding "every engagement across every org whose purge date has passed" is
 * a genuine cross-tenant read that `closecheck_app` cannot do by design (see the docstring on
 * `unscoped()` in src/lib/db/scoped.ts) — this is the standalone, separately-run, separately-audited
 * exception that comment points to, not a route the running app ever calls.
 *
 * Deletes: Evidence rows and their underlying files for every Finding under every Audit under a
 * due Engagement. Does NOT delete Reports/PDFs — those are the consultant's own generated
 * deliverable summarizing findings, not the raw seller-provided documents spec.md §8 is about.
 *
 * Run with: npm run db:purge-expired-documents
 */
import { PrismaClient } from "@prisma/client";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const STORAGE_ROOT = join(process.cwd(), ".local-storage");

async function main() {
  const dueEngagements = await prisma.engagement.findMany({
    where: { documentPurgeAt: { lte: new Date() } },
    select: { id: true, businessName: true, orgId: true, documentPurgeAt: true },
  });

  if (dueEngagements.length === 0) {
    console.log("No engagements due for document purge.");
    return;
  }

  for (const engagement of dueEngagements) {
    const evidence = await prisma.evidence.findMany({
      where: { finding: { audit: { engagementId: engagement.id } } },
      select: { id: true, storageKey: true },
    });

    for (const e of evidence) {
      if (e.storageKey) {
        await unlink(join(STORAGE_ROOT, e.storageKey)).catch((err) => {
          // Already gone is fine (e.g. a re-run after a partial prior failure); anything else is
          // worth seeing rather than silently continuing to delete the DB row for a file we
          // couldn't actually remove.
          if (err.code !== "ENOENT") throw err;
        });
      }
    }

    const { count } = await prisma.evidence.deleteMany({
      where: { id: { in: evidence.map((e) => e.id) } },
    });

    console.log(
      `Purged ${count} evidence document(s) for "${engagement.businessName}" (org ${engagement.orgId}, due ${engagement.documentPurgeAt?.toISOString()}).`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
