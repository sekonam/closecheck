import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

const run = promisify(execFile);

/**
 * End-to-end cover for the document retention purge (`docs/spec.md` §8).
 *
 * This exists because of the worst defect found in this codebase to date, and because for several
 * hours the fix for it was in exactly the state this suite has spent the day criticising: verified
 * once by hand, held by nothing.
 *
 * The original bug: the script computed its own storage root as `join(process.cwd(),
 * ".local-storage")`, ignoring STORAGE_ROOT_DIR — the variable that exists so production can point
 * at a mounted volume. On any deployment that set it, every unlink missed, the resulting ENOENT was
 * treated as "already purged", every Evidence row was deleted anyway, and the script printed a
 * success line. Seller documents survived on disk with the only pointers to them destroyed: a
 * retention failure that reported itself as a clean run.
 *
 * These drive the real script as a child process rather than importing a function out of it,
 * because the guards being tested are the script's own — its pre-flight, its exit code, its
 * argv handling. A test that called an extracted helper would not have caught the original bug,
 * which lived in a module-level constant.
 */
describe("the retention purge cannot destroy the only pointer to a document", () => {
  let org: OrgFixture;
  let storageRoot: string;
  let evidenceId: string;
  let storageKey: string;

  async function purge(env: Record<string, string>, args: string[] = []) {
    try {
      const { stdout } = await run(
        "npx",
        ["tsx", "-r", "dotenv/config", "scripts/purge-expired-documents.ts", ...args],
        { env: { ...process.env, ...env }, cwd: process.cwd() },
      );
      return { code: 0, output: stdout };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }

  beforeEach(async () => {
    org = await createOrgFixture("purge");
    storageRoot = await mkdtemp(join(tmpdir(), "closecheck-purge-"));

    const finding = await directPrisma.finding.findFirstOrThrow({ where: { orgId: org.orgId } });
    storageKey = `${org.orgId}/evidence/${finding.id}/contract.pdf`;
    const path = join(storageRoot, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "%PDF-1.4 seller contract");

    const evidence = await directPrisma.evidence.create({
      data: { orgId: org.orgId, findingId: finding.id, kind: "DOCUMENT", storageKey, text: "contract.pdf" },
    });
    evidenceId = evidence.id;

    // Due for purge: a terminal deal stage AND a date in the past. Both are required.
    await directPrisma.engagement.update({
      where: { id: org.engagementId },
      data: { dealStage: "CLOSED", documentPurgeAt: new Date(Date.now() - 86_400_000) },
    });
  });

  afterEach(async () => {
    if (org) await destroyOrgFixture(org.orgId);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("deletes the file and its row together when everything lines up", async () => {
    const { code, output } = await purge({ STORAGE_ROOT_DIR: storageRoot });
    expect(code, output).toBe(0);
    expect(existsSync(join(storageRoot, storageKey))).toBe(false);
    expect(await directPrisma.evidence.findUnique({ where: { id: evidenceId } })).toBeNull();
  });

  /**
   * THE REGRESSION. A storage root that exists but does not hold the file is exactly what a
   * cwd-relative path produced on a deployment using a mounted volume. The row must survive: it is
   * the only remaining pointer to a document that very likely still exists somewhere else.
   */
  it("keeps the row when the file is missing, and fails loudly", async () => {
    const empty = await mkdtemp(join(tmpdir(), "closecheck-empty-"));
    try {
      const { code, output } = await purge({ STORAGE_ROOT_DIR: empty });

      expect(code, "a run that purged nothing must not report success").not.toBe(0);
      expect(output).toMatch(/MISSING/i);

      const row = await directPrisma.evidence.findUnique({ where: { id: evidenceId } });
      expect(row, "the only pointer to the document was destroyed").not.toBeNull();

      // And the real document is untouched where it actually lives.
      expect(await readFile(join(storageRoot, storageKey), "utf8")).toContain("seller contract");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("refuses to start at all when the storage root does not exist", async () => {
    const { code, output } = await purge({ STORAGE_ROOT_DIR: join(tmpdir(), "closecheck-nonexistent-dir") });
    expect(code).not.toBe(0);
    expect(output).toMatch(/does not exist|Refusing to purge/i);
    // Zero deletions, not "deleted some then stopped".
    expect(await directPrisma.evidence.findUnique({ where: { id: evidenceId } })).not.toBeNull();
  });

  /**
   * A purge date is set when an engagement reaches a terminal stage, but the date is a stored
   * column and the stage can move on — a dead deal that revives leaves a live engagement carrying a
   * date nobody typed. Selecting on the date alone would delete a seller's contracts out of an
   * active diligence engagement.
   */
  it("ignores a due date on an engagement that is no longer in a terminal stage", async () => {
    await directPrisma.engagement.update({
      where: { id: org.engagementId },
      data: { dealStage: "POST_LOI" },
    });

    const { code } = await purge({ STORAGE_ROOT_DIR: storageRoot });
    expect(code).toBe(0);
    expect(existsSync(join(storageRoot, storageKey))).toBe(true);
    expect(await directPrisma.evidence.findUnique({ where: { id: evidenceId } })).not.toBeNull();
  });

  it("purges a dangling row only when explicitly told to", async () => {
    const empty = await mkdtemp(join(tmpdir(), "closecheck-empty2-"));
    try {
      const { code } = await purge({ STORAGE_ROOT_DIR: empty }, ["--force-missing"]);
      expect(code).toBe(0);
      expect(await directPrisma.evidence.findUnique({ where: { id: evidenceId } })).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
