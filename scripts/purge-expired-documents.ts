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

    // Delete each file and its row as one unit rather than unlinking everything then batch-deleting
    // rows afterward: a batched deleteMany run only after the whole unlink loop meant a single
    // mid-loop unlink failure (permissions, disk issue) threw before deleteMany ran at all, leaving
    // rows for already-deleted earlier files pointing at files that no longer exist (they'd then
    // 404/500 on download instead of being gone). Per-file deletion means a failure on one file
    // only skips that file's row, not every file already handled before it.
    let purgedCount = 0;
    for (const e of evidence) {
      if (e.storageKey) {
        const removed = await unlink(join(STORAGE_ROOT, e.storageKey))
          .then(() => true)
          .catch((err) => {
            // Already gone is fine (e.g. a re-run after a partial prior failure) — treat as purged.
            // Anything else: leave the row in place for a future re-run rather than deleting a row
            // whose file deletion we can't actually confirm.
            if (err.code === "ENOENT") return true;
            console.error(`Failed to unlink ${e.storageKey}, leaving its row for a future run:`, err);
            return false;
          });
        if (!removed) continue;
      }
      await prisma.evidence.delete({ where: { id: e.id } });
      purgedCount++;
    }

    console.log(
      `Purged ${purgedCount} evidence document(s) for "${engagement.businessName}" (org ${engagement.orgId}, due ${engagement.documentPurgeAt?.toISOString()}).`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
