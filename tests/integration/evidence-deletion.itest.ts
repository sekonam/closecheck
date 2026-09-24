import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { objectExists } from "@/lib/storage/objectStore";
import { launchBrowser, requireServer } from "./helpers/browser";
import { BASE_URL } from "./helpers/http";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

/**
 * Removing a document through the interface a consultant actually uses deletes the document.
 *
 * `deleteEvidence` used to delete the row and leave the object, on the reasoning that the retention
 * purge would collect it later. The purge finds documents only by joining through Evidence rows, so
 * once the row was gone nothing could ever reach the object: it was orphaned permanently, in the
 * bucket, with nothing in the database that knew it existed. Demonstrated against a live R2 bucket
 * on 2026-09-24, where a document survived its row, its engagement, its audit and the whole
 * consultant organisation. Fixed the same day.
 *
 * `src/lib/actions/evidence.test.ts` covers the ordering, the scoping and the failure path against
 * mocks. This covers what those cannot: that the real form on the real page, submitted by a real
 * signed-in consultant, reaches that code and that a real object leaves a real backend. The gap was
 * named in docs/security-posture.md as a "not yet true" before this existed.
 *
 * Deliberately asserts the object is present BEFORE the removal. A test that only checked it was
 * absent afterwards would pass identically if the upload had never written anything — which is the
 * shape of vacuous test this project has produced three times.
 */

const PASSWORD = "correct-horse-battery-staple-9";
/** A real PDF header: checkEvidenceContent compares magic bytes, so an invented file is refused. */
const PDF_BYTES = Buffer.from(`%PDF-1.4\n% seller contract fixture ${randomUUID()}\n`, "utf8");

let browser: Browser;
let org: OrgFixture;
let email: string;
let filePath: string;

beforeAll(async () => {
  await requireServer();
  browser = await launchBrowser();
  org = await createOrgFixture("evdel");

  email = `evdel-${randomUUID().slice(0, 8)}@itest.invalid`;
  await directPrisma.user.create({
    data: { orgId: org.orgId, email, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "OWNER" },
  });

  const dir = await mkdtemp(join(tmpdir(), "closecheck-evidence-"));
  filePath = join(dir, "executed-msa.pdf");
  await writeFile(filePath, PDF_BYTES);
});

afterAll(async () => {
  await browser?.close();
  if (org) await destroyOrgFixture(org.orgId);
});

async function signedInAuditPage(): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await page.goto(`${BASE_URL}/engagements/${org.engagementId}/audits/${org.auditId}`, {
    waitUntil: "domcontentloaded",
  });
  return page;
}

/** The storage key the app recorded, read back from the row the upload created. */
async function storedKeyFor(findingId: string): Promise<{ id: string; key: string }> {
  const row = await directPrisma.evidence.findFirstOrThrow({
    where: { findingId },
    orderBy: { createdAt: "desc" },
  });
  expect(row.storageKey, "the upload must have recorded a storage key").toBeTruthy();
  return { id: row.id, key: row.storageKey! };
}

describe("removing a document through the audit page", () => {
  it("writes the document, then deletes it from the backend when removed", async () => {
    const page = await signedInAuditPage();
    try {
      // Both the rating form and the attach form carry a hidden findingId, so the selector has to
      // name the file input as well — matching on findingId alone picks the rating form, which has
      // no file input and fails as a timeout rather than as a wrong match.
      const uploadForm = page
        .locator(`form:has(input[name="findingId"][value="${org.findingId}"]):has(input[type="file"])`)
        .first();
      await uploadForm.locator('input[type="file"]').setInputFiles(filePath);
      await uploadForm.locator('input[name="label"]').fill("Executed MSA");
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        uploadForm.locator('button[type="submit"]').click(),
      ]);
      await page.waitForTimeout(1500);

      const { id, key } = await storedKeyFor(org.findingId);

      // The control. Without it, the assertion after removal is satisfied by an upload that never
      // happened, and the test would pass against the very bug it exists to catch.
      expect(await objectExists(org.orgId, key), "the uploaded object must exist before removal").toBe(true);

      const removeForm = page.locator(`form:has(input[name="evidenceId"][value="${id}"])`).first();
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        removeForm.locator('button[type="submit"]').click(),
      ]);
      await page.waitForTimeout(1500);

      expect(
        await directPrisma.evidence.findUnique({ where: { id } }),
        "the row must be gone",
      ).toBeNull();
      expect(
        await objectExists(org.orgId, key),
        "the object must be gone too — a row-only delete is the orphan this test exists for",
      ).toBe(false);
    } finally {
      await page.context().close();
    }
  }, 90_000);
});
