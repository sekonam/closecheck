/**
 * Objects the backend holds that no database row names — reported, and deleted only on --apply.
 *
 * Why this exists: the retention purge, the download routes and every product path find objects
 * by joining through rows. An object whose row is gone is therefore invisible to all of them — not
 * parked for later collection, but permanently unreachable, sitting in the bucket with nothing in
 * the database that knows it is there. Two things produce that state: deleting an org (the cascade
 * removes every row in one statement, and there is no code on that path to hook), and any failure
 * between a row's deletion and its object's. Demonstrated against the real bucket on 2026-09-24: a
 * seller's document survived deletion of its evidence row, its engagement, its audit and the whole
 * consultant organisation.
 *
 * This is scripts/verify-storage-keys.ts run in the other direction. That one asks "does every key
 * the database names exist in the backend" (the orphaned ROW); this asks "does every key the
 * backend holds appear in the database" (the orphaned OBJECT). Both are exact, not sampled, for
 * the same reason: the failure is a single document, and a count cannot see it.
 *
 * Reports by default. Deletes only with --apply, and never touches the reserved
 * `_deployment-check/` prefix that verify:deployment writes under.
 *
 * Run with: npm run db:sweep-orphaned-objects [-- --apply] [-- --min-age-minutes=N]
 */
import { PrismaClient } from "@prisma/client";
import {
  assertStorageUsable,
  deleteObjectIfPresentAcrossOrgs,
  describeStorage,
  listAllObjectsAcrossOrgs,
} from "../src/lib/storage/objectStore";

const RESERVED_PREFIXES = ["_deployment-check/"];
const DEFAULT_MIN_AGE_MINUTES = 60;

function minAgeMinutes(): number {
  const arg = process.argv.find((a) => a.startsWith("--min-age-minutes="));
  if (!arg) return DEFAULT_MIN_AGE_MINUTES;
  const n = Number(arg.split("=")[1]);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--min-age-minutes must be a non-negative number, got ${arg}`);
  return n;
}

async function keysTheDatabaseNames(direct: PrismaClient): Promise<Set<string>> {
  const named = new Set<string>();
  for (const r of await direct.report.findMany({ select: { pdfStorageKey: true, brandSnapshotLogoKey: true } })) {
    if (r.pdfStorageKey) named.add(r.pdfStorageKey);
    if (r.brandSnapshotLogoKey) named.add(r.brandSnapshotLogoKey);
  }
  for (const e of await direct.evidence.findMany({ select: { storageKey: true } })) {
    if (e.storageKey) named.add(e.storageKey);
  }
  for (const o of await direct.consultantOrg.findMany({ select: { brandLogoUrl: true } })) {
    if (o.brandLogoUrl) named.add(o.brandLogoUrl);
  }
  return named;
}

async function main() {
  const apply = process.argv.includes("--apply");
  await assertStorageUsable();
  console.log(`Storage backend: ${describeStorage()}`);

  const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
  let named: Set<string>;
  try {
    named = await keysTheDatabaseNames(direct);
  } finally {
    await direct.$disconnect();
  }
  const held = await listAllObjectsAcrossOrgs();
  const minAge = minAgeMinutes();
  const cutoff = Date.now() - minAge * 60_000;
  const unnamed = held.filter((o) => !named.has(o.key) && !RESERVED_PREFIXES.some((p) => o.key.startsWith(p)));
  const tooYoung = unnamed.filter((o) => o.lastModified.getTime() > cutoff);
  const orphans = unnamed.filter((o) => o.lastModified.getTime() <= cutoff).map((o) => o.key);

  console.log(`Objects in backend: ${held.length}. Keys named by the database: ${named.size}.`);
  if (tooYoung.length) {
    console.log(
      `${tooYoung.length} unnamed object(s) younger than ${minAge} minute(s) left alone — a report ` +
        `being generated writes its objects before naming them; run again later if they persist.`,
    );
  }
  if (orphans.length === 0) {
    console.log("PASS: no orphaned objects — everything the backend holds is named by a row.");
    return;
  }
  console.log(`${orphans.length} orphaned object(s) — held by the backend, named by no row:`);
  for (const k of orphans) console.log(`  ${k}`);

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to delete them. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  let deleted = 0;
  let failed = 0;
  for (const k of orphans) {
    try {
      if ((await deleteObjectIfPresentAcrossOrgs(k)) === "deleted") deleted++;
    } catch (err) {
      failed++;
      console.log(`  FAILED ${k}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`Deleted ${deleted}; failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
