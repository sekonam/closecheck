/**
 * Restore-verification drill (docs/roadmap.md Phase 2.5). A backup nobody has ever restored is a
 * belief, not a backup — this script turns "we take backups" into a repeatable, automatable proof:
 * dump the real database, restore it into a scratch database on the same local Postgres instance,
 * assert the restore is actually usable, then drop the scratch database. It is read-only against the
 * source: pg_dump only ever SELECTs from it, and nothing in this file issues DROP/DELETE/TRUNCATE
 * against DIRECT_DATABASE_URL's own database.
 *
 * "Usable" here means three things a restore can silently get wrong even when pg_dump/psql both
 * exit 0:
 *   1. Every table's row count matches the source (a truncated or partially-applied restore can
 *      still exit 0 if later statements in the dump succeed).
 *   2. Row-level security is still enforced (docs/spec.md §8) — pg_dump captures CREATE POLICY and
 *      ENABLE/FORCE ROW LEVEL SECURITY by default, but a `--no-*` flag typo or an older pg_dump
 *      without policy support would silently produce a restore with the data but not the isolation
 *      guarantee, which is the one failure mode spec.md §8 says this product cannot afford anywhere,
 *      including in a disaster-recovery path nobody looks at until the day it matters.
 *   3. The narrow per-role grants (prisma/migrations/20260911160500 and 20260922090000 — e.g.
 *      closecheck_app has no SELECT on error_events) survived the restore, not just "a" grant.
 *
 * For (2) and (3) this compares the restored database's pg_catalog state against the SOURCE
 * database's, rather than hardcoding an expected table/grant list here — a second copy of that list
 * would drift the day someone adds a tenant table and updates the RLS migration but not this script.
 * Comparing against the source itself can't drift: whatever the source actually has right now is
 * what the restore is being held to.
 *
 * SAFETY:
 *   - Refuses to run against anything that isn't localhost/127.0.0.1 unless --force is passed —
 *     see assertLocalOrForced() below. This is a drill that creates and drops a database; running it
 *     against a real target by accident (a copy-pasted production DIRECT_DATABASE_URL) is exactly
 *     the kind of mistake a host guard exists to catch.
 *   - The scratch database and the temp dump file are always cleaned up, including on failure — see
 *     the try/finally in main().
 *
 * Run with: npm run ops:backup-drill [-- --force]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const HOMEBREW_PG15_BIN = "/opt/homebrew/opt/postgresql@15/bin";

type Check = { label: string; pass: boolean; detail?: string };

// ---------------------------------------------------------------------------
// Binary resolution — prefer whatever `pg_dump`/`psql`/`createdb` resolve to on PATH (matches
// however the environment actually has Postgres installed); fall back to the Homebrew postgresql@15
// cellar only when PATH has nothing, since that's where this project's docs say a local dev Postgres
// tends to live (see the "Local Postgres when Docker is down" note this environment's operators use).
// ---------------------------------------------------------------------------

type PgBinary = "pg_dump" | "psql" | "createdb";

function resolveBinary(name: PgBinary): string {
  const onPath = spawnSync(name, ["--version"], { stdio: "ignore" });
  // spawnSync sets `.error` (ENOENT) when the executable can't be found at all; a non-zero exit code
  // for `--version` would be a different, more surprising failure that's worth surfacing rather than
  // silently falling back past it.
  if (!onPath.error) return name;
  const fallback = join(HOMEBREW_PG15_BIN, name);
  if (existsSync(fallback)) return fallback;
  throw new Error(
    `Could not find "${name}" on PATH or at ${fallback}. Install Postgres client tools, or adjust HOMEBREW_PG15_BIN in this script.`,
  );
}

// ---------------------------------------------------------------------------
// Safety guard
// ---------------------------------------------------------------------------

export function assertLocalOrForced(url: URL, force: boolean): void {
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (isLocal || force) return;
  throw new Error(
    `Refusing to run the backup drill against host "${url.hostname}" — this looks like it could be a ` +
      `production database, and this drill creates/drops a scratch database on the target server. ` +
      `Re-run with --force if you are certain this is safe (e.g. a shared non-production instance).`,
  );
}

// ---------------------------------------------------------------------------
// Subprocess helper — every pg_dump/createdb/psql invocation goes through this so credentials are
// passed via the PGPASSWORD environment variable rather than embedded in a connection-string argv
// entry, which would otherwise be visible to anything that can read this process's command line
// (e.g. `ps`) for as long as the subprocess runs.
// ---------------------------------------------------------------------------

function runPg(bin: string, args: string[], url: URL): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(bin, args, {
    env: { ...process.env, PGPASSWORD: url.password },
    encoding: "utf8",
  });
  return { ok: result.status === 0 && !result.error, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function connArgs(url: URL, dbName: string): string[] {
  return ["-h", url.hostname, "-p", url.port || "5432", "-U", url.username, "-d", dbName];
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function listPublicTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  return rows.map((r) => r.tablename);
}

async function tableRowCounts(prisma: PrismaClient, tables: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of tables) {
    // Table names come from pg_tables (the catalog), never from user input, so building this
    // identifier by interpolation is safe the same way rotate-production-role-passwords.ts's role
    // interpolation is — the risk $queryRaw's tagged-template parameterization guards against is
    // user-controlled *values*, and there is no parameterized way to pass a table name to Postgres.
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${table}"`);
    counts.set(table, Number(rows[0]?.n ?? 0));
  }
  return counts;
}

/** relname -> relrowsecurity/relforcerowsecurity/sorted policy names, for tables that have RLS
 * enabled in the SOURCE database — the set to check for in the restored copy. */
async function rlsState(prisma: PrismaClient): Promise<Map<string, { forced: boolean; policies: string[] }>> {
  const tables = await prisma.$queryRaw<{ relname: string; relforcerowsecurity: boolean }[]>`
    SELECT c.relname, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true`;
  const policies = await prisma.$queryRaw<{ tablename: string; policyname: string }[]>`
    SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`;
  const byTable = new Map<string, string[]>();
  for (const p of policies) {
    byTable.set(p.tablename, [...(byTable.get(p.tablename) ?? []), p.policyname].sort());
  }
  const out = new Map<string, { forced: boolean; policies: string[] }>();
  for (const t of tables) {
    out.set(t.relname, { forced: t.relforcerowsecurity, policies: byTable.get(t.relname) ?? [] });
  }
  return out;
}

/** relname -> ACL entries as text, for every table — used to diff privileges/grants between the
 * source and the restored copy without hardcoding which roles or privileges to look for. */
async function tableAcls(prisma: PrismaClient): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ relname: string; acl: string | null }[]>`
    SELECT c.relname, c.relacl::text AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'`;
  return new Map(rows.map((r) => [r.relname, r.acl ?? ""]));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const force = process.argv.includes("--force");
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (!directUrl) throw new Error("DIRECT_DATABASE_URL is not set.");
  const sourceUrl = new URL(directUrl);
  assertLocalOrForced(sourceUrl, force);

  const pgDump = resolveBinary("pg_dump");
  const psql = resolveBinary("psql");
  const createdb = resolveBinary("createdb");

  const sourceDb = sourceUrl.pathname.replace(/^\//, "");
  if (!sourceDb) throw new Error(`DIRECT_DATABASE_URL has no database name: ${directUrl}`);
  const scratchDb = `${sourceDb}_backup_drill_${Date.now()}`;

  const tmpDir = await mkdtemp(join(tmpdir(), "closecheck-backup-drill-"));
  const dumpFile = join(tmpDir, "dump.sql");

  const checks: Check[] = [];
  let scratchCreated = false;
  let scratchPrisma: PrismaClient | undefined;
  let sourcePrisma: PrismaClient | undefined;

  try {
    console.log(`Dumping "${sourceDb}" (source, read-only) to ${dumpFile} ...`);
    const dump = runPg(pgDump, [...connArgs(sourceUrl, sourceDb), "-f", dumpFile], sourceUrl);
    checks.push({ label: "pg_dump completed", pass: dump.ok, detail: dump.ok ? undefined : dump.stderr.trim() });
    if (!dump.ok) throw new Error("pg_dump failed — see check detail above.");

    console.log(`Creating scratch database "${scratchDb}" ...`);
    const create = runPg(createdb, [...connArgs(sourceUrl, "postgres").slice(0, 6), scratchDb], sourceUrl);
    checks.push({ label: "createdb completed", pass: create.ok, detail: create.ok ? undefined : create.stderr.trim() });
    if (!create.ok) throw new Error("createdb failed — see check detail above.");
    scratchCreated = true;

    console.log(`Restoring dump into "${scratchDb}" ...`);
    const restore = runPg(
      psql,
      [...connArgs(sourceUrl, scratchDb), "-v", "ON_ERROR_STOP=1", "-f", dumpFile],
      sourceUrl,
    );
    checks.push({ label: "psql restore completed with no error", pass: restore.ok, detail: restore.ok ? undefined : restore.stderr.trim() });
    if (!restore.ok) throw new Error("Restore failed — see check detail above.");

    const scratchUrl = new URL(sourceUrl.toString());
    scratchUrl.pathname = `/${scratchDb}`;
    sourcePrisma = new PrismaClient({ datasourceUrl: sourceUrl.toString() });
    scratchPrisma = new PrismaClient({ datasourceUrl: scratchUrl.toString() });

    // --- Check 1: every table's row count matches ---
    const sourceTables = await listPublicTables(sourcePrisma);
    const restoredTables = await listPublicTables(scratchPrisma);
    const missingTables = sourceTables.filter((t) => !restoredTables.includes(t));
    checks.push({
      label: "restored copy has every source table",
      pass: missingTables.length === 0,
      detail: missingTables.length ? `missing: ${missingTables.join(", ")}` : undefined,
    });

    const sourceCounts = await tableRowCounts(sourcePrisma, sourceTables);
    const restoredCounts = await tableRowCounts(scratchPrisma, sourceTables.filter((t) => restoredTables.includes(t)));
    const countMismatches: string[] = [];
    for (const table of sourceTables) {
      const expected = sourceCounts.get(table) ?? 0;
      const actual = restoredCounts.get(table) ?? -1;
      if (expected !== actual) countMismatches.push(`${table}: source=${expected} restored=${actual}`);
    }
    checks.push({
      label: `row counts match for all ${sourceTables.length} table(s)`,
      pass: countMismatches.length === 0,
      detail: countMismatches.length ? countMismatches.join("; ") : undefined,
    });

    // --- Check 2: RLS survived on every table that has it in the source ---
    const sourceRls = await rlsState(sourcePrisma);
    const restoredRls = await rlsState(scratchPrisma);
    const rlsMismatches: string[] = [];
    for (const [table, expected] of sourceRls) {
      const actual = restoredRls.get(table);
      if (!actual) {
        rlsMismatches.push(`${table}: RLS not enabled in restored copy`);
        continue;
      }
      if (actual.forced !== expected.forced) {
        rlsMismatches.push(`${table}: FORCE ROW LEVEL SECURITY expected=${expected.forced} actual=${actual.forced}`);
      }
      if (JSON.stringify(actual.policies) !== JSON.stringify(expected.policies)) {
        rlsMismatches.push(
          `${table}: policies expected=[${expected.policies.join(",")}] actual=[${actual.policies.join(",")}]`,
        );
      }
    }
    checks.push({
      label: `row-level security intact on all ${sourceRls.size} RLS-protected table(s)`,
      pass: rlsMismatches.length === 0,
      detail: rlsMismatches.length ? rlsMismatches.join("; ") : undefined,
    });

    // --- Check 3: per-table grants (ACLs) survived, compared against the source rather than a
    // hardcoded expectation (see the module comment for why) ---
    const sourceAcls = await tableAcls(sourcePrisma);
    const restoredAcls = await tableAcls(scratchPrisma);
    const aclMismatches: string[] = [];
    for (const [table, expected] of sourceAcls) {
      const actual = restoredAcls.get(table) ?? "(table missing)";
      if (actual !== expected) aclMismatches.push(`${table}: expected=[${expected}] actual=[${actual}]`);
    }
    checks.push({
      label: `table grants (ACLs) match source for all ${sourceAcls.size} table(s)`,
      pass: aclMismatches.length === 0,
      detail: aclMismatches.length ? aclMismatches.join("; ") : undefined,
    });
  } finally {
    // Cleanup must run even if an assertion threw above — a failed drill that leaves a scratch
    // database behind on every failed run would foul the next run's `createdb` and slowly litter the
    // instance with abandoned databases, which is its own kind of operational rot.
    if (sourcePrisma) await sourcePrisma.$disconnect().catch(() => {});
    if (scratchPrisma) await scratchPrisma.$disconnect().catch(() => {});
    if (scratchCreated) {
      console.log(`Dropping scratch database "${scratchDb}" ...`);
      // DROP DATABASE cannot run while any connection to it is still open — the $disconnect() calls
      // above must complete first, which is why this is the last step rather than a fire-and-forget
      // one issued in parallel with something still holding a connection.
      const drop = runPg(psql, [...connArgs(sourceUrl, "postgres"), "-c", `DROP DATABASE IF EXISTS "${scratchDb}"`], sourceUrl);
      if (!drop.ok) {
        console.error(
          `WARNING: failed to drop scratch database "${scratchDb}" — drop it manually: DROP DATABASE "${scratchDb}";\n${drop.stderr}`,
        );
      }
    }
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log("\nBackup drill results");
  console.log("=".repeat(60));
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}: ${c.label}`);
    if (!c.pass && c.detail) console.log(`      ${c.detail}`);
  }
  const allPass = checks.length > 0 && checks.every((c) => c.pass);
  console.log("\n" + (allPass ? "PASS: backup is restorable and usable." : "FAIL: see above."));
  if (!allPass) process.exitCode = 1;
}

// Same ESM direct-run guard as the other two ops scripts — lets tests import assertLocalOrForced
// without running the actual drill (which would dump/create/restore/drop a real database) as an
// import side effect.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
