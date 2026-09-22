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
 * SAFETY MODEL (rewritten 2026-09-22 after a review found the opposite failure):
 *
 * This script previously computed its own storage root as `join(process.cwd(), ".local-storage")`,
 * ignoring STORAGE_ROOT_DIR — the variable that exists precisely so production can point at a
 * mounted volume. Running it on any deployment that set that variable unlinked nothing (every path
 * was wrong), treated the resulting ENOENT as "already purged", deleted every Evidence row anyway,
 * and printed a success line. The documents survived on disk with the only pointers to them gone:
 * a retention failure that reported itself as a clean run, which is worse than a loud crash.
 *
 * Three rules now make that shape impossible rather than merely fixed:
 *   1. The storage root comes from the storage module itself (storageRoot()), never recomputed here.
 *   2. Pre-flight aborts before touching a single row if that root does not exist — a misconfigured
 *      path fails fast, at zero rows deleted, instead of deleting everything.
 *   3. A file that is missing when its row says it should exist is an ANOMALY, not a success. The
 *      row is kept (it is the only remaining pointer to a document that may well exist elsewhere),
 *      the key is reported, and the run exits non-zero so a cron surfaces it. `--force-missing`
 *      purges those rows for an operator who has checked the storage root and confirmed the files
 *      are genuinely gone.
 *
 * Run with: npm run db:purge-expired-documents [-- --engagement=<id>] [-- --force-missing]
 */
import { DealStage, PrismaClient } from "@prisma/client";
import { stat } from "node:fs/promises";
import { deleteObjectIfPresent, storageRoot } from "../src/lib/storage/local";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const forceMissing = process.argv.includes("--force-missing");

/**
 * Restricts the run to one engagement.
 *
 * Operationally this is the "a client has asked us to delete their documents now" path — a founder
 * should be able to honour that for one deal without waiting for the scheduled sweep or purging
 * every other due engagement at the same time.
 *
 * It also exists because the unscoped default is genuinely dangerous to run anywhere shared. This
 * script deletes evidence for EVERY due engagement in the database, so running it against a
 * development or test database destroys whatever else is in there — which is not hypothetical: the
 * integration test for this script did exactly that to another session's fixtures before it was
 * scoped. Anything automated that invokes this should name its engagement.
 */
const engagementArg = process.argv.find((arg) => arg.startsWith("--engagement="));
const onlyEngagementId = engagementArg ? engagementArg.slice("--engagement=".length) : null;

type Totals = { purged: number; missing: number; failed: number };

async function assertStorageRootUsable(root: string): Promise<void> {
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) {
    throw new Error(
      `Storage root ${root} does not exist or is not a directory. Refusing to purge: every unlink ` +
        `would fail and the Evidence rows pointing at those documents would be the only thing ` +
        `destroyed. Set STORAGE_ROOT_DIR to the volume the app actually writes to, then re-run.`,
    );
  }
}

async function main() {
  const root = storageRoot();
  await assertStorageRootUsable(root);
  console.log(
    `Storage root: ${root}${forceMissing ? " (--force-missing)" : ""}` +
      (onlyEngagementId ? ` (--engagement=${onlyEngagementId})` : " (all due engagements)"),
  );

  // Both conditions, not just the date. A purge date is set when an engagement reaches a terminal
  // stage, but the date is a stored column and the stage can move on afterwards — a dead deal that
  // revives, with a form re-submitting its own prefilled date, leaves a live engagement carrying a
  // purge date nobody typed. Selecting on the date alone would then delete a seller's contracts out
  // of an active diligence engagement on a schedule set weeks earlier.
  //
  // Requiring the stage as well makes that unreachable regardless of how the date got there: if the
  // engagement is not CLOSED or DEAD right now, nothing about it is eligible for deletion. The
  // stage is the fact that matters; the date only says when.
  const dueEngagements = await prisma.engagement.findMany({
    where: {
      documentPurgeAt: { lte: new Date() },
      dealStage: { in: [DealStage.CLOSED, DealStage.DEAD] },
      // Narrowing only — an explicitly named engagement still has to be genuinely due. The flag
      // chooses WHICH due engagements to purge, never whether the retention rules apply.
      ...(onlyEngagementId ? { id: onlyEngagementId } : {}),
    },
    select: { id: true, businessName: true, orgId: true, documentPurgeAt: true, dealStage: true },
  });

  if (dueEngagements.length === 0) {
    console.log("No engagements due for document purge.");
    return;
  }

  const totals: Totals = { purged: 0, missing: 0, failed: 0 };

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
    const perEngagement: Totals = { purged: 0, missing: 0, failed: 0 };

    for (const e of evidence) {
      if (e.storageKey) {
        let outcome: "deleted" | "missing";
        try {
          outcome = await deleteObjectIfPresent(e.storageKey);
        } catch (err) {
          console.error(`  FAILED to unlink ${e.storageKey}, keeping its row for a future run:`, err);
          perEngagement.failed++;
          continue;
        }

        if (outcome === "missing" && !forceMissing) {
          console.error(
            `  MISSING file for evidence ${e.id} (key ${e.storageKey}) — keeping the row. The row is ` +
              `the only pointer to this document; verify the storage root, then re-run with ` +
              `--force-missing if the file is genuinely gone.`,
          );
          perEngagement.missing++;
          continue;
        }
        if (outcome === "missing") {
          console.warn(`  Purging row for already-missing file ${e.storageKey} (--force-missing).`);
        }
      }
      await prisma.evidence.delete({ where: { id: e.id } });
      perEngagement.purged++;
    }

    totals.purged += perEngagement.purged;
    totals.missing += perEngagement.missing;
    totals.failed += perEngagement.failed;

    console.log(
      `"${engagement.businessName}" (org ${engagement.orgId}, ${engagement.dealStage}, due ${engagement.documentPurgeAt?.toISOString()}): ` +
        `${perEngagement.purged} purged, ${perEngagement.missing} missing, ${perEngagement.failed} failed.`,
    );
  }

  console.log(
    `\nTotal: ${totals.purged} purged, ${totals.missing} missing, ${totals.failed} failed.`,
  );

  // Non-zero on anything unpurged so a scheduled run is a retention alarm, not a silent log line.
  if (totals.missing > 0 || totals.failed > 0) {
    console.error(
      "Retention run incomplete — documents remain unaccounted for. This is a spec.md §8 issue, not a warning.",
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
