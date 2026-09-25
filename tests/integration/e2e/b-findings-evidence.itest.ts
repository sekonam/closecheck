import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectPageErrors, launchBrowser, requireServer } from "../helpers/browser";
import type { Locator } from "playwright";
import { BASE_URL } from "../helpers/http";
import { objectExists } from "@/lib/storage/objectStore";

/**
 * E2E plan 2026-09-25, area B rows B5–B7: findings and evidence as a consultant handles them.
 * B8 (citations) and B9 (vendor memory) are held by tests/integration/audit-workflow.itest.ts and
 * are not duplicated here.
 */
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `E2E-B Evidence ${suffix}`;
const EMAIL = `e2e-b-ev-${suffix}@itest.invalid`;
const PASSWORD = "correct-horse-battery-staple-9";
const CONTRACT_CARD = 'div.rounded-lg:has-text("Primary business-system contract terms")';

// A 1x1 PNG: the upload path checks leading bytes, so a fixture that merely ends in .png proves nothing.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

/**
 * Same waiting rules as helpers/browser.ts (a server action re-renders in place; navigating away
 * cancels it; networkidle never fires under next dev) with a budget sized for a dev server shared
 * with three other drivers, where the shared helper's 30s produced false failures.
 */
async function submitAndSettle(page: Page, locator: Locator): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 120_000 }),
    locator.click(),
  ]);
}
async function submitExpectingRefusal(page: Page, locator: Locator): Promise<void> {
  await Promise.all([page.waitForURL(/[?&]error=/, { timeout: 120_000 }), locator.click()]);
}

let browser: Browser;
let page: Page;
let pageErrors: ReturnType<typeof collectPageErrors>;
let orgId: string;
let auditUrl: string;
let auditId: string;
let tempDir: string;
let pdfPath: string;
let pngPath: string;
let hugePath: string;

describe("B · findings and evidence, through the UI", () => {
  beforeAll(async () => {
    await requireServer();
    browser = await launchBrowser();
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(120_000);
    page.setDefaultTimeout(60_000);
    pageErrors = collectPageErrors(page);

    tempDir = await mkdtemp(join(tmpdir(), "closecheck-e2e-b-"));
    pdfPath = join(tempDir, "lease-2024.pdf");
    pngPath = join(tempDir, "pos-screenshot.png");
    hugePath = join(tempDir, "huge.pdf");
    await writeFile(pdfPath, PDF);
    await writeFile(pngPath, PNG_1x1);
    // Just over the 15 MB cap, with a real PDF header so the SIZE rule is what refuses it.
    await writeFile(hugePath, Buffer.concat([PDF, Buffer.alloc(15 * 1024 * 1024, 0x20)]));

    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="orgName"]', ORG_NAME);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirmPassword"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 120_000 }),
      page.locator('form:has(input[name="orgName"]) button[type="submit"]').click(),
    ]);
    orgId = (await direct.consultantOrg.findFirstOrThrow({ where: { name: ORG_NAME } })).id;

    await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
    const form = page.locator('form:has(input[name="businessName"])');
    await form.locator('input[name="businessName"]').fill(`Evidence Cafe ${suffix}`);
    await Promise.all([
      page.waitForURL(/\/engagements\/[a-z0-9]+$/, { timeout: 120_000 }),
      form.locator('button[type="submit"]').click(),
    ]);
    const start = page.locator('form:has(select[name="templateSlug"])');
    await start.locator('select[name="templateSlug"]').selectOption("restaurant-online-ordering");
    await Promise.all([
      page.waitForURL(/\/audits\/[a-z0-9]+$/, { timeout: 120_000 }),
      start.locator('button[type="submit"]').click(),
    ]);
    auditUrl = page.url();
    auditId = auditUrl.split("/audits/")[1];
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    if (orgId) await direct.consultantOrg.delete({ where: { id: orgId } }).catch(() => {});
    await direct.$disconnect();
  });

  function findingForm() {
    return page.locator(CONTRACT_CARD).first().locator('form:has(select[name="status"])').first();
  }
  function evidenceForm() {
    return page.locator(CONTRACT_CARD).first().locator('form:has(input[type="file"])').first();
  }

  it("B5 · status, severity and note persist; Red without a note is refused in plain language", async () => {
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const finding = await direct.finding.findFirstOrThrow({
      where: { auditId, templateItem: { title: { contains: "Primary business-system contract terms" } } },
    });
    expect(finding.status).toBe("NOT_STARTED");
    expect(finding.severity).toBeNull();

    const form = findingForm();
    await form.locator('select[name="status"]').selectOption("FAIL");
    await form.locator('select[name="severity"]').selectOption("YELLOW");
    await form.locator('input[name="note"]').fill("Assignment needs Toast's consent (§14.2).");
    await submitAndSettle(page, form.locator('button[type="submit"]'));
    const saved = await direct.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(saved.status).toBe("FAIL");
    expect(saved.severity).toBe("YELLOW");
    expect(saved.note).toContain("§14.2");

    // Red with the note cleared: refused, and the message is written for a consultant.
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const again = findingForm();
    await again.locator('select[name="severity"]').selectOption("RED");
    await again.locator('input[name="note"]').fill("");
    await submitExpectingRefusal(page, again.locator('button[type="submit"]'));
    const body = await page.innerText("body");
    expect(body).toContain("Red finding needs a note");
    expect(body, "an internal document reference leaked into consultant-facing copy").not.toMatch(/spec\.md|docs\/|§\s*4\b/);
    // Nothing was written by the refused submit.
    const unchanged = await direct.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(unchanged.severity).toBe("YELLOW");
    expect(unchanged.note).toContain("§14.2");
  }, 180_000);

  it("B6 · a PDF and a PNG are attached with provenance; an oversize file is refused with its size", async () => {
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const before = await direct.evidence.count({ where: { orgId } });

    let form = evidenceForm();
    await form.locator('input[type="file"]').setInputFiles(pdfPath);
    await form.locator('input[name="label"]').fill("Lease, executed");
    await submitAndSettle(page, form.locator('button:has-text("Attach")'));

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    form = evidenceForm();
    await form.locator('input[type="file"]').setInputFiles(pngPath);
    await submitAndSettle(page, form.locator('button:has-text("Attach")'));

    const rows = await direct.evidence.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    expect(rows.length).toBe(before + 2);
    const [pdfRow, pngRow] = rows.slice(-2);
    expect(pdfRow.mimeType).toBe("application/pdf");
    expect(pdfRow.sizeBytes).toBe(PDF.length);
    expect(pdfRow.label).toBe("Lease, executed");
    expect(pdfRow.uploadedById).not.toBeNull();
    expect(pngRow.mimeType).toBe("image/png");
    expect(pngRow.sizeBytes).toBe(PNG_1x1.length);
    for (const r of rows.slice(-2)) {
      expect(r.storageKey).toBeTruthy();
      expect(await objectExists(orgId, r.storageKey!), `object missing for ${r.text}`).toBe(true);
    }

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const body = (await page.innerText("body")).replace(/\s+/g, " ");
    expect(body).toContain("Lease, executed");
    expect(body).toContain("lease-2024.pdf");
    expect(body).toContain("pos-screenshot.png");
    expect(body).toMatch(/PNG image · \d+ B · added by .+ on \d{4}-\d{2}-\d{2}/);

    // Oversize: refused, names the size and the limit, writes nothing.
    form = evidenceForm();
    await form.locator('input[type="file"]').setInputFiles(hugePath);
    await submitExpectingRefusal(page, form.locator('button:has-text("Attach")'));
    const refusal = await page.innerText("body");
    expect(refusal).toMatch(/15\.0 MB/);
    expect(refusal).toMatch(/limit for one attachment/i);
    expect(await direct.evidence.count({ where: { orgId } })).toBe(before + 2);
  }, 240_000);

  it("B7 · download returns the exact bytes; delete removes the row, the object, and the download", async () => {
    const pdfRow = await direct.evidence.findFirstOrThrow({ where: { orgId, mimeType: "application/pdf" } });
    const res = await page.request.get(`${BASE_URL}/api/evidence/${pdfRow.id}`);
    expect(res.status()).toBe(200);
    const bytes = await res.body();
    expect(Buffer.compare(bytes, await readFile(pdfPath)), "downloaded bytes differ from the upload").toBe(0);
    // Deliberately NOT the stored MIME type. A seller's document is content the product neither
    // authored nor can vouch for; served inline from the app's origin, any HTML or SVG among the
    // uploads would be a stored-XSS vector against the consultant's session. octet-stream plus an
    // attachment disposition and nosniff means the browser saves it whatever it turns out to be.
    // (src/app/api/evidence/[evidenceId]/route.ts) — pinned here so a "helpful" change to serve the
    // real type has to delete a test that explains why it must not.
    expect(res.headers()["content-type"]).toContain("application/octet-stream");
    expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename="lease-2024\.pdf"/);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const removeForm = page.locator(`form:has(input[name="evidenceId"][value="${pdfRow.id}"])`);
    expect(await removeForm.count(), "no Remove control for the evidence row").toBe(1);
    expect(await objectExists(orgId, pdfRow.storageKey!)).toBe(true);
    await submitAndSettle(page, removeForm.locator('button:has-text("Remove")'));

    expect(await direct.evidence.findUnique({ where: { id: pdfRow.id } }), "row survived Remove").toBeNull();
    expect(await objectExists(orgId, pdfRow.storageKey!), "object survived Remove").toBe(false);
    const gone = await page.request.get(`${BASE_URL}/api/evidence/${pdfRow.id}`);
    expect(gone.status()).toBe(404);

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    expect(await page.innerText("body")).not.toContain("lease-2024.pdf");
  }, 180_000);

  it("logged no page errors", async () => {
    // The B7 404 is provoked by request.get, not the page, so nothing here is expected noise.
    expect(pageErrors.significant(), pageErrors.significant().join("\n")).toEqual([]);
  });
});
