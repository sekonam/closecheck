import { PrismaClient } from "@prisma/client";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectPageErrors, launchBrowser, requireServer, submitAndSettle, submitExpectingRefusal } from "../helpers/browser";
import { BASE_URL } from "../helpers/http";
import { createOrgFixture, destroyOrgFixture, type OrgFixture } from "../helpers/fixtures";

/**
 * E2E plan 2026-09-25, area B rows B1–B4, B10, B11: the engagement and audit lifecycle as a
 * consultant drives it, in a real browser, against the running app and the real database.
 *
 * Every assertion reads state BEFORE and AFTER the UI action from the database directly, because
 * a test that only checks the after-state passes identically if the action never ran.
 */
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `E2E-B Lifecycle ${suffix}`;
const EMAIL = `e2e-b-${suffix}@itest.invalid`;
const PASSWORD = "correct-horse-battery-staple-9";
const BUSINESS = `Lifecycle Bistro ${suffix}`;
const CONTRACT_CARD = 'div.rounded-lg:has-text("Primary business-system contract terms")';

let browser: Browser;
let page: Page;
let pageErrors: ReturnType<typeof collectPageErrors>;
let orgId: string;
let engagementId: string;
let auditUrl: string;
let auditId: string;
let other: OrgFixture;

async function signUp() {
  await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="orgName"]', ORG_NAME);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="confirmPassword"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 120_000 }),
    page.locator('form:has(input[name="orgName"]) button[type="submit"]').click(),
  ]);
  const org = await direct.consultantOrg.findFirstOrThrow({ where: { name: ORG_NAME } });
  orgId = org.id;
}

async function ledger(id: string) {
  return direct.auditCreditEntry.findMany({ where: { orgId: id }, orderBy: { createdAt: "asc" } });
}

describe("B · engagements and audits, through the UI", () => {
  beforeAll(async () => {
    await requireServer();
    browser = await launchBrowser();
    page = await browser.newPage();
    // The dev server is shared with three other drivers during the E2E run; compile-on-first-hit
    // plus load makes a 30s navigation budget a source of false failures.
    page.setDefaultNavigationTimeout(120_000);
    page.setDefaultTimeout(60_000);
    pageErrors = collectPageErrors(page);
    await signUp();
    other = await createOrgFixture("b-other");
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    if (other) await destroyOrgFixture(other.orgId).catch(() => {});
    if (orgId) await direct.consultantOrg.delete({ where: { id: orgId } }).catch(() => {});
    await direct.$disconnect();
  });

  it("B1 · creates an engagement, edits it, and a terminal stage schedules retention", async () => {
    await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
    const form = page.locator('form:has(input[name="businessName"])');
    await form.locator('input[name="businessName"]').fill(BUSINESS);
    await form.locator('input[name="primaryDomain"]').fill("example.com");
    await Promise.all([
      page.waitForURL(/\/engagements\/[a-z0-9]+$/, { timeout: 120_000 }),
      form.locator('button[type="submit"]').click(),
    ]);
    const created = await direct.engagement.findFirstOrThrow({ where: { orgId, businessName: BUSINESS } });
    engagementId = created.id;
    expect(created.primaryDomain).toBe("example.com");
    expect(created.documentPurgeAt, "a non-terminal engagement must not have a purge date").toBeNull();

    // Edit: rename and change the domain; the deal stage stays non-terminal.
    const edit = page.locator('form:has(input[name="engagementId"]):has(select[name="dealStage"])');
    await edit.locator('input[name="businessName"]').fill(`${BUSINESS} (renamed)`);
    await edit.locator('select[name="dealStage"]').selectOption("POST_LOI");
    await submitAndSettle(page, edit.locator('button[type="submit"]'));
    const renamed = await direct.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    expect(renamed.businessName).toBe(`${BUSINESS} (renamed)`);
    expect(renamed.dealStage).toBe("POST_LOI");
    expect(renamed.documentPurgeAt).toBeNull();

    // Terminal stage: retention default is applied (spec.md §8, 90 days), and the page shows it.
    await page.goto(`${BASE_URL}/engagements/${engagementId}`, { waitUntil: "domcontentloaded" });
    const edit2 = page.locator('form:has(input[name="engagementId"]):has(select[name="dealStage"])');
    await edit2.locator('select[name="dealStage"]').selectOption("CLOSED");
    await submitAndSettle(page, edit2.locator('button[type="submit"]'));
    const closed = await direct.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    expect(closed.dealStage).toBe("CLOSED");
    expect(closed.documentPurgeAt, "CLOSED did not schedule a purge date").not.toBeNull();
    const days = Math.round((closed.documentPurgeAt!.getTime() - Date.now()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(89);
    expect(days).toBeLessThanOrEqual(91);
    await page.goto(`${BASE_URL}/engagements/${engagementId}`, { waitUntil: "domcontentloaded" });
    expect(await page.locator('input[name="documentPurgeAt"]').inputValue()).toBe(
      closed.documentPurgeAt!.toISOString().slice(0, 10),
    );

    // Back to an active stage for the rest of the suite; the date survives (it is only cleared by hand).
    const edit3 = page.locator('form:has(input[name="engagementId"]):has(select[name="dealStage"])');
    await edit3.locator('select[name="dealStage"]').selectOption("PRE_LOI");
    await submitAndSettle(page, edit3.locator('button[type="submit"]'));
    expect((await direct.engagement.findUniqueOrThrow({ where: { id: engagementId } })).dealStage).toBe("PRE_LOI");
  }, 120_000);

  it("B2 · starts an audit from every active template: findings per item, version pinned, no credit", async () => {
    const templates = await direct.template.findMany({ where: { isActive: true }, include: { items: true } });
    expect(templates.length).toBeGreaterThanOrEqual(4);
    const before = (await ledger(orgId)).length;
    for (const t of templates) {
      await page.goto(`${BASE_URL}/engagements/${engagementId}`, { waitUntil: "domcontentloaded" });
      const start = page.locator('form:has(select[name="templateSlug"])');
      await start.locator('select[name="templateSlug"]').selectOption(t.slug);
      await Promise.all([
        page.waitForURL(/\/audits\/[a-z0-9]+$/, { timeout: 120_000 }),
        start.locator('button[type="submit"]').click(),
      ]);
      const id = page.url().split("/audits/")[1];
      const audit = await direct.audit.findUniqueOrThrow({ where: { id }, include: { findings: true, template: true } });
      expect(audit.templateId, `audit not pinned to the active ${t.slug} template`).toBe(t.id);
      expect(audit.template.version).toBe(t.version);
      expect(audit.findings.length, `findings count for ${t.slug}`).toBe(t.items.length);
      expect(audit.findings.every((f) => f.status === "NOT_STARTED")).toBe(true);
      expect(audit.creditConsumedAt).toBeNull();
      if (t.slug === "restaurant-online-ordering") {
        auditUrl = page.url();
        auditId = id;
      }
    }
    expect((await ledger(orgId)).length, "starting audits consumed credits").toBe(before);
  }, 240_000);

  it("B3 · runs Tier A against a real public domain, twice: findings populate, no credit, idempotent", async () => {
    const automated = await direct.finding.findMany({
      where: { auditId, templateItem: { automationKey: { not: null } } },
      include: { templateItem: true },
    });
    expect(automated.length, "template has no automatable items").toBeGreaterThan(0);
    expect(automated.every((f) => f.status === "NOT_STARTED")).toBe(true);

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const runForm = page.locator('form:has(button:has-text("Run Tier A automated checks"))');
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST", { timeout: 120_000 }),
      runForm.locator("button").click(),
    ]);
    // Poll the DB: the action redirects when done, but the redirect race is not the signal we want.
    let after = automated;
    for (let i = 0; i < 60; i++) {
      after = await direct.finding.findMany({ where: { id: { in: automated.map((f) => f.id) } }, include: { templateItem: true } });
      if (after.some((f) => f.status !== "NOT_STARTED")) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const touched = after.filter((f) => f.status !== "NOT_STARTED");
    expect(touched.length, "Tier A run left every automated finding NOT_STARTED").toBeGreaterThan(0);
    expect((await ledger(orgId)).length, "Tier A consumed a credit").toBe(0);
    expect((await direct.audit.findUniqueOrThrow({ where: { id: auditId } })).creditConsumedAt).toBeNull();

    const findingCount = await direct.finding.count({ where: { auditId } });
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const body = (await page.innerText("body")).replace(/\s+/g, " ");
    expect(body, "page shows no trace of the automated run").toMatch(/automat|checked|last run/i);

    // Re-run: no new findings, no credit, results refreshed rather than duplicated.
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST", { timeout: 120_000 }),
      page.locator('form:has(button:has-text("Run Tier A automated checks")) button').click(),
    ]);
    await new Promise((r) => setTimeout(r, 3000));
    expect(await direct.finding.count({ where: { auditId } })).toBe(findingCount);
    expect((await ledger(orgId)).length).toBe(0);
  }, 300_000);

  it("B4 · the credit notice before and after the first Tier B/C entry; balance decrements once", async () => {
    await direct.auditCreditEntry.create({ data: { orgId, delta: 3, reason: "PLAN_GRANT", note: "e2e grant" } });
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    let body = (await page.innerText("body")).replace(/\s+/g, " ");
    expect(body).toContain("Tier A screening is included in your plan");
    expect(body).toContain("3 remaining");
    expect(body).not.toContain("used one audit credit");

    // First Tier B entry: rate the contract item.
    const form = page.locator(CONTRACT_CARD).first().locator('form:has(select[name="status"])').first();
    await form.locator('select[name="severity"]').selectOption("GREEN");
    await submitAndSettle(page, form.locator('button[type="submit"]'));

    const audit = await direct.audit.findUniqueOrThrow({ where: { id: auditId } });
    expect(audit.creditConsumedAt, "first Tier B entry did not stamp the audit").not.toBeNull();
    const rows = await ledger(orgId);
    expect(rows.filter((r) => r.reason === "AUDIT_CONSUMED")).toHaveLength(1);

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    body = (await page.innerText("body")).replace(/\s+/g, " ");
    expect(body).toContain("This audit used one audit credit on");
    expect(body).not.toContain("Tier A screening is included");

    // Second entry on the same audit: nothing more.
    const form2 = page.locator(CONTRACT_CARD).first().locator('form:has(select[name="status"])').first();
    await form2.locator('input[name="note"]').fill("second entry, same audit");
    await submitAndSettle(page, form2.locator('button[type="submit"]'));
    expect((await ledger(orgId)).filter((r) => r.reason === "AUDIT_CONSUMED")).toHaveLength(1);
  }, 120_000);

  it("B10 · marks the audit complete and reopens it; the webhook receiver gets identifiers only", async () => {
    const { createServer } = await import("node:http");
    const received: string[] = [];
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        received.push(data);
        res.writeHead(200);
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const endpoint = await direct.webhookEndpoint.create({
      data: { orgId, url: `http://127.0.0.1:${port}/hook`, secret: `whsec_e2e_${suffix}` },
    });
    try {
      await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
      expect((await direct.audit.findUniqueOrThrow({ where: { id: auditId } })).status).toBe("IN_PROGRESS");
      await submitAndSettle(page, page.locator('form:has(button:has-text("Mark audit complete")) button'));
      expect((await direct.audit.findUniqueOrThrow({ where: { id: auditId } })).status).toBe("COMPLETE");

      for (let i = 0; i < 30 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 500));
      const ep = await direct.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
      if (received.length === 0) {
        // A receiver on 127.0.0.1 may be refused by the outbound host guard; that is a documented
        // property, not a bug, but it means this row cannot be verified here — say so.
        expect(ep.lastFailureReason, "no delivery and no recorded failure reason").not.toBeNull();
        console.log("B10: delivery to 127.0.0.1 refused by design:", ep.lastFailureReason);
      } else {
        const payload = received[0];
        expect(payload).toContain(auditId);
        expect(payload).toContain("audit.completed");
        expect(payload, "webhook payload carried finding content").not.toMatch(/second entry, same audit/);
        expect(ep.lastSuccessAt).not.toBeNull();
      }

      await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
      await submitAndSettle(page, page.locator('form:has(button:has-text("Reopen audit")) button'));
      expect((await direct.audit.findUniqueOrThrow({ where: { id: auditId } })).status).toBe("IN_PROGRESS");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 120_000);

  let errorsBeforeB11 = 0;
  it("B11 · another org's ids in URLs and form posts: not found, never data, never a 500", async () => {
    errorsBeforeB11 = pageErrors.significant().length;
    const otherEng = await direct.engagement.findUniqueOrThrow({ where: { id: other.engagementId } });
    for (const path of [
      `/engagements/${other.engagementId}`,
      `/engagements/${other.engagementId}/audits/${other.auditId}`,
      `/engagements/${engagementId}/audits/${other.auditId}`,
    ]) {
      const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `${path} returned a server error`).toBeLessThan(500);
      const body = await page.innerText("body");
      expect(body, `${path} leaked the other org's business name`).not.toContain(otherEng.businessName);
      expect(body, `${path} leaked the other org's finding note`).not.toContain("SECRET");
    }

    // Form post with a foreign findingId: swap the hidden id on our own audit page and submit.
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const form = page.locator(CONTRACT_CARD).first().locator('form:has(select[name="status"])').first();
    await form.locator('input[name="findingId"]').evaluate((el, id) => ((el as HTMLInputElement).value = id), other.findingId);
    await form.locator('input[name="note"]').fill("cross-org write attempt");
    await submitExpectingRefusal(page, form.locator('button[type="submit"]'));
    expect(await page.innerText("body")).toMatch(/not found/i);
    const foreign = await direct.finding.findUniqueOrThrow({ where: { id: other.findingId } });
    expect(foreign.note, "a cross-org form post modified another org's finding").not.toContain("cross-org write attempt");
  }, 120_000);

  it("logged no page errors across the lifecycle", async () => {
    const all = pageErrors.significant();
    // B11 provokes 404s on purpose; those resource-load messages are the expected outcome there,
    // not a defect. Everything before B11, and anything in B11 that is not a 404, must be clean.
    expect(all.slice(0, errorsBeforeB11), all.slice(0, errorsBeforeB11).join("\n")).toEqual([]);
    const duringB11 = all.slice(errorsBeforeB11).filter((m) => !/status of 404/.test(m));
    expect(duringB11, duringB11.join("\n")).toEqual([]);
  });
});
