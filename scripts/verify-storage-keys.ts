/**
 * Every storage key the database names must resolve in the configured backend.
 *
 * This is the check that makes switching storage backends safe, and the reason it is exact rather
 * than statistical: the failure it guards against is an ORPHANED ROW — a Report or Evidence row
 * whose object was never carried across — and that presents to a consultant not as an error but as
 * "the report was never generated". A count of objects can match while the one key a consultant
 * needs is missing; a sample can pass while missing that same key. So every key is checked, one
 * HEAD each, through the same storage seam and the same tenancy guard every real read uses.
 *
 * Four columns hold keys (prisma/schema.prisma): reports.pdfStorageKey, reports.brandSnapshotLogoKey,
 * evidence.storageKey, consultant_orgs.brandLogoUrl. The snapshot logo is the one a sample would
 * most plausibly miss — rare, and only present on reports generated before a firm's live logo
 * changed.
 *
 * Run BEFORE cutover, with the new backend configured and the old one still holding the originals,
 * because that is when a failure is recoverable by re-running the copy. The same failure after
 * cutover is a support incident. See docs/deployment.md, "Object storage".
 *
 * Reads only. Exits non-zero naming every unresolved key.
 *
 * Run with: npm run db:verify-storage-keys
 */
import { PrismaClient } from "@prisma/client";
import { describeStorage, objectExists } from "../src/lib/storage/objectStore";

type Named = { table: string; column: string; rowId: string; orgId: string; key: string };

async function main() {
  const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
  const named: Named[] = [];
  try {
    // DIRECT_DATABASE_URL bypasses RLS on purpose: this must see every firm's rows, and it reads
    // key strings only — never document content.
    for (const r of await direct.report.findMany({
      select: { id: true, orgId: true, pdfStorageKey: true, brandSnapshotLogoKey: true },
    })) {
      if (r.pdfStorageKey) named.push({ table: "reports", column: "pdfStorageKey", rowId: r.id, orgId: r.orgId, key: r.pdfStorageKey });
      if (r.brandSnapshotLogoKey) named.push({ table: "reports", column: "brandSnapshotLogoKey", rowId: r.id, orgId: r.orgId, key: r.brandSnapshotLogoKey });
    }
    for (const e of await direct.evidence.findMany({ select: { id: true, orgId: true, storageKey: true } })) {
      if (e.storageKey) named.push({ table: "evidence", column: "storageKey", rowId: e.id, orgId: e.orgId, key: e.storageKey });
    }
    for (const o of await direct.consultantOrg.findMany({ select: { id: true, brandLogoUrl: true } })) {
      if (o.brandLogoUrl) named.push({ table: "consultant_orgs", column: "brandLogoUrl", rowId: o.id, orgId: o.id, key: o.brandLogoUrl });
    }
  } finally {
    await direct.$disconnect();
  }

  console.log(`Storage backend: ${describeStorage()}`);
  console.log(`Keys named by the database: ${named.length}`);

  const unresolved: (Named & { reason: string })[] = [];
  for (const n of named) {
    try {
      if (!(await objectExists(n.orgId, n.key))) unresolved.push({ ...n, reason: "not found" });
    } catch (err) {
      // A backend error is not "missing" — but it is still "not proven present", which is the
      // only answer this script may give a key it could not check.
      unresolved.push({ ...n, reason: err instanceof Error ? err.message.split("\n")[0] : String(err) });
    }
  }

  if (unresolved.length === 0) {
    console.log(`PASS: all ${named.length} keys resolve in the configured backend.`);
    return;
  }
  console.log(`FAIL: ${unresolved.length} of ${named.length} keys do not resolve:`);
  for (const u of unresolved) {
    console.log(`  ${u.table}.${u.column} row ${u.rowId} (org ${u.orgId}): ${u.key} — ${u.reason}`);
  }
  console.log("Do not cut over. Re-run the copy for the keys above, then run this again.");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
