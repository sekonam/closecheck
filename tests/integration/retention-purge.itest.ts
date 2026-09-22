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
  let reportPdfKey: string;
  let portalLink: { id: string };

  /**
   * Runs the real script. Note what callers must NOT assert on: the process exit code, except where
   * this fixture's own condition forces it.
   *
   * The script scans every engagement in the database, and this suite shares one with every other
   * spec. A leftover due engagement from another file — pointing at a temp storage root that no
   * longer exists — makes the run report a missing document and exit non-zero, which has nothing to
   * do with the case under test. Asserting `code === 0` therefore made these tests pass or fail on
   * what else happened to be in the database, and they did: green in isolation, red in the full
   * suite, green again on the next run. A global assertion cannot express a fixture-scoped claim.
   *
   * So the assertions below are scoped to this fixture's own row, its own file, and the script's
   * own per-engagement summary line. Exit code is asserted only in the two cases where this
   * fixture's condition guarantees it regardless of anything else present.
   */
  async function purge(env: Record<string, string>, args: string[] = []) {
    try {
      const { stdout } = await run(
        "npx",
        [
          "tsx",
          "-r",
          "dotenv/config",
          "scripts/purge-expired-documents.ts",
          // ALWAYS scoped to this fixture's own engagement. Unscoped, this script deletes evidence
          // for every due engagement in the database — and this suite shares one with every other
          // spec and with anyone else working against it. An earlier version of this file ran it
          // unscoped and destroyed another session's fixture rows mid-probe. A test must not be
          // capable of that, and scoping also removes the cross-spec contamination that made these
          // assertions depend on what else happened to be due.
          `--engagement=${org.engagementId}`,
          ...args,
        ],
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

    // A rendered report PDF and a live portal link, which retention now also covers.
    reportPdfKey = `${org.orgId}/reports/${org.reportId}.pdf`;
    const reportPath = join(storageRoot, reportPdfKey);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, "%PDF-1.4 generated report");
    await directPrisma.report.update({
      where: { id: org.reportId },
      data: { pdfStorageKey: reportPdfKey },
    });
    portalLink = await directPrisma.clientPortalLink.create({
      data: {
        orgId: org.orgId,
        reportId: org.reportId,
        token: `purge-itest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

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
    const { output } = await purge({ STORAGE_ROOT_DIR: storageRoot });

    // This engagement's own summary line, not the global result.
    expect(output, output).toMatch(new RegExp(`${org.orgId}[^\\n]*1 purged, 0 missing, 0 failed`));
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

      // Safe to assert: this fixture's own missing file forces a non-zero exit whatever else the
      // database holds. Other rows can only reinforce it, never mask it.
      expect(code, "a run that purged nothing must not report success").not.toBe(0);
      expect(output).toMatch(new RegExp(`MISSING file for evidence ${evidenceId}`));

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

    const { output } = await purge({ STORAGE_ROOT_DIR: storageRoot });

    // Named explicitly and still not purged: the flag narrows which due engagements are processed,
    // it never overrides the retention rules themselves.
    expect(output).toMatch(/No engagements due for document purge/);
    expect(existsSync(join(storageRoot, storageKey))).toBe(true);
    expect(await directPrisma.evidence.findUnique({ where: { id: evidenceId } })).not.toBeNull();
  });

  it("purges a dangling row only when explicitly told to", async () => {
    const empty = await mkdtemp(join(tmpdir(), "closecheck-empty2-"));
    try {
      const { output } = await purge({ STORAGE_ROOT_DIR: empty }, ["--force-missing"]);
      expect(output, output).toMatch(new RegExp(`${org.orgId}[^\\n]*1 purged`));
      expect(await directPrisma.evidence.findUnique({ where: { id: evidenceId } })).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  /**
   * Report PDFs were deliberately excluded from retention until 2026-09-22, on the reasoning that a
   * generated report is the consultant's own deliverable rather than raw seller material. What
   * changed is that the appendix LISTS the documents and tells the buyer they can be obtained from
   * the firm — so a report outliving the documents behind it is not stale data, it is a false
   * statement the product keeps serving, in a file the buyer still holds.
   */
  it("deletes the rendered report PDF but keeps the Report row", async () => {
    const { output } = await purge({ STORAGE_ROOT_DIR: storageRoot });
    expect(output, output).toMatch(/1 report PDF\(s\) deleted/);
    expect(existsSync(join(storageRoot, reportPdfKey))).toBe(false);

    const report = await directPrisma.report.findUnique({ where: { id: org.reportId } });
    // The row is the consultant's own record of what they concluded — severity, coverage, brand
    // snapshot — and contains no seller documents. Only the rendered file should go.
    expect(report, "the Report row was deleted; only its file should have been").not.toBeNull();
    expect(report?.pdfStorageKey, "the pointer must be cleared with the file").toBeNull();
    expect(report?.computedOverallSeverity, "the conclusion must survive").toBeTruthy();
  });

  it("revokes live portal links rather than deleting them", async () => {
    await purge({ STORAGE_ROOT_DIR: storageRoot });

    const link = await directPrisma.clientPortalLink.findUnique({ where: { id: portalLink.id } });
    // Deleting would erase who had already been given access — the §8 access trail hangs off this
    // row, and "who saw this report" must still have an answer after a purge.
    expect(link, "the link row was deleted; it should have been revoked").not.toBeNull();
    expect(link?.revokedAt, "a live link serving a deleted PDF is a broken page for the buyer").not.toBeNull();
  });

  it("leaves the report alone when the engagement is not in a terminal stage", async () => {
    await directPrisma.engagement.update({
      where: { id: org.engagementId },
      data: { dealStage: "POST_LOI" },
    });
    await purge({ STORAGE_ROOT_DIR: storageRoot });

    expect(existsSync(join(storageRoot, reportPdfKey))).toBe(true);
    const link = await directPrisma.clientPortalLink.findUnique({ where: { id: portalLink.id } });
    expect(link?.revokedAt).toBeNull();
  });
});
