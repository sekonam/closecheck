import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type Browser, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";
import { BASE_URL } from "./helpers/http";
import { collectPageErrors, launchBrowser, requireServer, submitAndSettle } from "./helpers/browser";

/**
 * The consultant's whole journey, in a real browser, against the running app.
 *
 * Everything else in this directory tests a layer: RLS, a payload, a route. None of them would
 * catch a signup form that posts to nothing, a server action that throws on render, or a report
 * page that 500s — the failures a first design partner would actually hit. This walks the path a
 * stranger takes: sign up, create an engagement, open an audit, record a finding, generate a
 * report, and view it through a client portal link.
 *
 * Written as a Playwright script inside the integration suite rather than a one-off manual session
 * so it is repeatable and runs with everything else. Playwright is already a dependency (the PDF
 * pipeline uses it), and PLAYWRIGHT_CHROMIUM_PATH points it at a system browser in environments
 * where the bundled download is unavailable — the same override src/lib/reports/pdf.ts documents.
 *
 * Cleanup deletes the org it created, which cascades to everything below it.
 */
const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `E2E Journey ${suffix}`;
const EMAIL = `e2e-journey-${suffix}@itest.invalid`;
const PASSWORD = "correct-horse-battery-staple-9";

describe("a stranger can complete the core loop in a real browser", () => {
  let browser: Browser;
  let page: Page;
  let pageErrors: ReturnType<typeof collectPageErrors>;

  beforeAll(async () => {
    await requireServer();
    browser = await launchBrowser();
    page = await browser.newPage();
    // A page that renders but logs a React hydration or server-action error is broken in a way a
    // status-code assertion cannot see, so failures are collected and asserted at the end.
    pageErrors = collectPageErrors(page);
  });

  afterAll(async () => {
    await browser?.close();
    const org = await directPrisma.consultantOrg.findFirst({ where: { name: ORG_NAME } });
    if (org) await directPrisma.consultantOrg.delete({ where: { id: org.id } }).catch(() => {});
    await directPrisma.$disconnect();
  });

  it("signs up and lands inside the app", async () => {
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="orgName"]', ORG_NAME);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirmPassword"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 30_000 }),
      page.locator('form:has(input[name="orgName"]) button[type="submit"]').click(),
    ]);
    expect(page.url()).not.toContain("/signup");

    const org = await directPrisma.consultantOrg.findFirst({ where: { name: ORG_NAME } });
    expect(org, "signup did not create a ConsultantOrg").toBeTruthy();
  });

  it("creates an engagement", async () => {
    await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
    // Scoped to the form, not `button[type="submit"]`: the app chrome's "Sign out" is also a submit
    // button and comes first in the DOM, so an unscoped click silently logs the session out and
    // every later step then fails for a reason that has nothing to do with what is being tested.
    const newEngagement = page.locator('form:has(input[name="businessName"])');
    await newEngagement.locator('input[name="businessName"]').fill(`E2E Diner ${suffix}`);
    await newEngagement.locator('input[name="primaryDomain"]').fill("example.com");
    await Promise.all([
      page.waitForURL(/\/engagements\/[^/]+$/, { timeout: 30_000 }),
      newEngagement.locator('button[type="submit"]').click(),
    ]);

    const engagement = await directPrisma.engagement.findFirst({
      where: { businessName: `E2E Diner ${suffix}` },
    });
    expect(engagement, "no Engagement row was created").toBeTruthy();
  });

  it("opens the engagement and starts an audit", async () => {
    const engagement = await directPrisma.engagement.findFirstOrThrow({
      where: { businessName: `E2E Diner ${suffix}` },
    });
    await page.goto(`${BASE_URL}/engagements/${engagement.id}`, { waitUntil: "domcontentloaded" });
    expect(await page.innerText("body")).toContain(`E2E Diner ${suffix}`);

    // Three forms live on this page (edit engagement, start audit, sign out); target the one that
    // carries the template picker.
    const startAudit = page.locator('form:has(select[name="templateSlug"])');
    expect(await startAudit.count()).toBeGreaterThan(0);
    await submitAndSettle(page, startAudit.locator('button[type="submit"]'));

    const audit = await directPrisma.audit.findFirst({ where: { engagementId: engagement.id } });
    expect(audit, "no Audit row was created").toBeTruthy();
  });

  it("renders the audit page with its checklist items", async () => {
    const audit = await directPrisma.audit.findFirstOrThrow({
      where: { engagement: { businessName: `E2E Diner ${suffix}` } },
      include: { engagement: true },
    });
    const response = await page.goto(
      `${BASE_URL}/engagements/${audit.engagementId}/audits/${audit.id}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(response?.status(), "audit page did not return 200").toBe(200);

    const findings = await directPrisma.finding.count({ where: { auditId: audit.id } });
    expect(findings, "audit created no findings from its template").toBeGreaterThan(0);

    // Tier labels are the audit page's core structure (spec.md §4); their absence means the page
    // rendered a shell without the checklist.
    const text = await page.innerText("body");
    expect(text).toMatch(/Tier/i);
  });

  it("blocks report generation until the disclaimer has been reviewed", async () => {
    const audit = await directPrisma.audit.findFirstOrThrow({
      where: { engagement: { businessName: `E2E Diner ${suffix}` } },
    });
    await page.goto(`${BASE_URL}/engagements/${audit.engagementId}/audits/${audit.id}`, {
      waitUntil: "domcontentloaded",
    });

    // spec.md §6 makes disclaimer review a required gate, not optional boilerplate. A disabled
    // button is the whole point of that decision, so assert it rather than clicking past it.
    const generate = page.locator('form:has(input[name="includeAppendix"]) button[type="submit"]');
    expect(await generate.isDisabled()).toBe(true);
  });

  it("enables report generation once the disclaimer is acknowledged on Settings", async () => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    await submitAndSettle(page, page.getByRole("button", { name: /reviewed this language/i }));

    const org = await directPrisma.consultantOrg.findFirstOrThrow({ where: { name: ORG_NAME } });
    expect(org.disclaimerAcknowledgedAt).toBeTruthy();
  });

  it("generates a report", async () => {
    const audit = await directPrisma.audit.findFirstOrThrow({
      where: { engagement: { businessName: `E2E Diner ${suffix}` } },
    });
    await page.goto(`${BASE_URL}/engagements/${audit.engagementId}/audits/${audit.id}`, {
      waitUntil: "domcontentloaded",
    });
    await submitAndSettle(
      page,
      page.locator('form:has(input[name="includeAppendix"]) button[type="submit"]'),
    );

    const report = await directPrisma.report.findFirst({ where: { auditId: audit.id } });
    expect(report, "no Report row was created").toBeTruthy();
    expect(report?.computedOverallSeverity).toBeTruthy();
  });

  it("serves the report PDF to the signed-in consultant", async () => {
    const report = await directPrisma.report.findFirstOrThrow({
      where: { audit: { engagement: { businessName: `E2E Diner ${suffix}` } } },
    });
    // Through the browser context so the session cookie rides along — this route is authenticated.
    const response = await page.request.get(`${BASE_URL}/api/reports/${report.id}/pdf`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("pdf");
    const body = await response.body();
    // %PDF- is the format's magic number; a 200 carrying an HTML error page would pass a status
    // check but fail here, which is the failure actually worth catching.
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("creates a client portal link and serves it to an anonymous visitor", async () => {
    const report = await directPrisma.report.findFirstOrThrow({
      where: { audit: { engagement: { businessName: `E2E Diner ${suffix}` } } },
      include: { audit: true },
    });
    await page.goto(
      `${BASE_URL}/engagements/${report.audit.engagementId}/audits/${report.auditId}`,
      { waitUntil: "domcontentloaded" },
    );
    await submitAndSettle(page, page.getByRole("button", { name: /create client link/i }).first());

    const link = await directPrisma.clientPortalLink.findFirstOrThrow({
      where: { reportId: report.id },
    });

    // A genuinely separate browser context: no cookies, no session. The portal's entire premise
    // (spec.md §7) is no-account access, and testing it in the logged-in context would prove
    // nothing about whether it works for the buyer it exists for.
    const anonymous = await browser.newContext();
    try {
      const anonPage = await anonymous.newPage();
      const response = await anonPage.goto(`${BASE_URL}/portal/${link.token}`, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(200);

      // The portal page is a shell that frames the report PDF rather than re-rendering the findings
      // as HTML, so what belongs on it is the sharing firm's identity and the whitelabel framing —
      // the report's own content arrives in the embedded document, asserted next.
      const shell = await anonPage.innerText("body");
      expect(shell).toContain(ORG_NAME);
      expect(shell.toLowerCase()).toContain("read-only");

      // The document itself, fetched with no session at all. This is the assertion that actually
      // matters: a portal page that renders but whose PDF 401s is a broken deliverable.
      const pdf = await anonPage.request.get(`${BASE_URL}/portal/${link.token}/pdf`);
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

      // And a wrong token must not be a way in.
      const bad = await anonPage.goto(`${BASE_URL}/portal/not-a-real-token-${suffix}`, {
        waitUntil: "domcontentloaded",
      });
      expect(bad?.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await anonymous.close();
    }
  });

  it("reports no console or page errors across the whole journey", () => {
    const real = pageErrors.significant();
    expect(real, `console errors during the journey:\n${real.join("\n")}`).toEqual([]);
  });
});
