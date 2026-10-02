import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { type Browser, type BrowserContext } from "playwright";
import { BASE_URL } from "../helpers/http";
import { launchBrowser, requireServer } from "../helpers/browser";
import type { Locator, Page } from "playwright";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "../helpers/fixtures";

/**
 * E2E plan area D, rows D5–D7: every page the product has, visited in a real browser — signed in
 * where the page needs it — collecting console errors and warnings (D5), at a 400px viewport with
 * no horizontal scroll (D6), and the not-found paths for bogus ids and tokens (D7). A page that
 * renders but logs a hydration error, or one that overflows on a phone, is broken in a way no
 * status code shows.
 */
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `E2E-D Sweep ${suffix}`;
const EMAIL = `e2e-d-sweep-${suffix}@example.com`;
const PASSWORD = `E2eDs-${suffix}-pass!`;
const DINER = `E2E-D Sweep Diner ${suffix}`;

type Visit = { url: string; errors: string[]; warnings: string[]; status: number | null };


/** helpers/browser.submitAndSettle with a budget that survives a shared, loaded dev server. */
async function submitAndSettle(page: Page, locator: Locator): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 120_000 }),
    locator.click(),
  ]);
}

describe("area D — page sweeps: console, viewport, not-found", () => {
  let browser: Browser;
  let context: BrowserContext;
  let orgId: string;
  let engagementId: string;
  let auditId: string;
  let fixture: OrgFixture;
  let portalToken: string;
  let signedInPages: string[] = [];
  let publicPages: string[] = [];

  beforeAll(async () => {
    await requireServer();
    browser = await launchBrowser();
    context = await browser.newContext();
    context.setDefaultTimeout(120_000);
    context.setDefaultNavigationTimeout(120_000);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="orgName"]', ORG_NAME);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirmPassword"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 120_000 }),
      page.locator('form:has(input[name="orgName"]) button[type="submit"]').click(),
    ]);
    orgId = (await directPrisma.consultantOrg.findFirstOrThrow({ where: { name: ORG_NAME } })).id;
    await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
    const newEngagement = page.locator('form:has(input[name="businessName"])');
    await newEngagement.locator('input[name="businessName"]').fill(DINER);
    await newEngagement.locator('input[name="primaryDomain"]').fill("example.com");
    await submitAndSettle(page, newEngagement.locator('button[type="submit"]'));
    engagementId = (await directPrisma.engagement.findFirstOrThrow({ where: { businessName: DINER } })).id;
    await page.goto(`${BASE_URL}/engagements/${engagementId}`, { waitUntil: "domcontentloaded" });
    await submitAndSettle(page, page.locator('form:has(select[name="templateSlug"]) button[type="submit"]'));
    auditId = (await directPrisma.audit.findFirstOrThrow({ where: { engagementId } })).id;
    await page.close();

    // A portal link on a fixture report, so the unauthenticated portal page is part of the sweep.
    fixture = await createOrgFixture("d-sweep-portal");
    portalToken = randomBytes(24).toString("hex");
    await directPrisma.clientPortalLink.create({
      data: { orgId: fixture.orgId, reportId: fixture.reportId, token: portalToken, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    signedInPages = [
      `${BASE_URL}/engagements`,
      `${BASE_URL}/engagements/${engagementId}`,
      `${BASE_URL}/engagements/${engagementId}/audits/${auditId}`,
      `${BASE_URL}/settings`,
    ];
    publicPages = [`${BASE_URL}/login`, `${BASE_URL}/signup`, `${BASE_URL}/pricing`, `${BASE_URL}/portal/${portalToken}`];
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    if (orgId) await directPrisma.consultantOrg.delete({ where: { id: orgId } }).catch(() => {});
    if (fixture) await destroyOrgFixture(fixture.orgId);
    await directPrisma.$disconnect();
  });

  async function visit(ctx: BrowserContext, url: string, viewport?: { width: number; height: number }): Promise<Visit & { scrollWidth: number }> {
    const page = await ctx.newPage();
    if (viewport) await page.setViewportSize(viewport);
    const errors: string[] = [];
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
      if (m.type() === "warning") warnings.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    // Hydration and client effects land after domcontentloaded; give them a real moment.
    await page.waitForTimeout(2_000);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const status = response?.status() ?? null;
    await page.close();
    const noise = /favicon|DevTools|Download the React DevTools|Extension|sourcemap/i;
    return { url, errors: errors.filter((e) => !noise.test(e)), warnings: warnings.filter((w) => !noise.test(w)), status, scrollWidth };
  }

  it("D5: every page loads with zero console errors (warnings reported)", async () => {
    const results = [];
    for (const url of signedInPages) results.push(await visit(context, url));
    const anon = await browser.newContext();
    for (const url of publicPages) results.push(await visit(anon, url));
    await anon.close();
    const report = results.map((r) => `${r.status} ${r.url.replace(BASE_URL, "")}\n    errors: ${JSON.stringify(r.errors)}\n    warnings: ${JSON.stringify(r.warnings)}`).join("\n");
    console.log(`D5 sweep:\n${report}`);
    for (const r of results) expect(r.status, `${r.url} status`).toBe(200);
    const failing = results.filter((r) => r.errors.length > 0);
    expect(failing.map((r) => ({ url: r.url, errors: r.errors })), "console/page errors").toEqual([]);
  }, 240_000);

  /**
   * D6: every page fits a 400px viewport. Three pages overflowed when this was first measured
   * (2026-09-25: engagement 413, audit 512, settings 490 — one control each) and were held in an
   * expected-failure half until fixed; they are fixed, so there is one strict test again.
   */
  async function measureAll() {
    const results = [];
    for (const url of signedInPages) results.push(await visit(context, url, { width: 400, height: 800 }));
    const anon = await browser.newContext();
    for (const url of publicPages) results.push(await visit(anon, url, { width: 400, height: 800 }));
    await anon.close();
    console.log(`D6 sweep: ${results.map((r) => `${r.url.replace(BASE_URL, "")}=${r.scrollWidth}`).join(", ")}`);
    return results;
  }
  it("D6: every page fits a 400px viewport", async () => {
    const results = await measureAll();
    expect(results.length).toBeGreaterThanOrEqual(8);
    const overflowing = results.filter((r) => r.scrollWidth > 400).map((r) => `${r.url} scrollWidth=${r.scrollWidth}`);
    expect(overflowing, "pages overflowing 400px").toEqual([]);
  }, 240_000);

  it("D7: bogus ids and tokens render the branded not-found page, never a stack trace", async () => {
    // Two audiences, two correct answers. A consultant who mistypes an id should get the app's own
    // "Not found". A BUYER holding a dead or revoked portal link must not: this row used to require
    // the consultant copy everywhere, and that is what let the portal 404 ship its only control as
    // "Back to Engagements" — walking the buyer into "Sign in to your consultant account", which is
    // precisely what spec.md §2 principle 4 forbids. The portal case now asserts buyer-appropriate
    // copy AND that there is no route into the product and no CloseCheck branding.
    const cases = [
      { ctx: context, url: `${BASE_URL}/engagements/does-not-exist-${suffix}`, audience: "consultant" as const },
      { ctx: context, url: `${BASE_URL}/engagements/${engagementId}/audits/does-not-exist-${suffix}`, audience: "consultant" as const },
      // A real audit id under the wrong engagement must not resolve either.
      { ctx: context, url: `${BASE_URL}/engagements/${fixture.engagementId}/audits/${auditId}`, audience: "consultant" as const },
      { ctx: context, url: `${BASE_URL}/portal/not-a-real-token-${suffix}`, audience: "buyer" as const },
    ];
    for (const c of cases) {
      const page = await c.ctx.newPage();
      const response = await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
      const expected = c.audience === "buyer" ? "This link is no longer available" : "Not found";
      // The not-found boundary renders after the RSC payload streams in; read the body once it has.
      await page.getByText(expected).first().waitFor({ state: "visible", timeout: 120_000 }).catch(() => {});
      const body = await page.innerText("body");
      expect(response?.status(), `${c.url} status`).toBe(404);
      expect(body, `${c.url} branded copy`).toContain(expected);
      expect(body, `${c.url} leaks internals`).not.toMatch(/at \w+ \(|node_modules|\.tsx?:\d+|Unhandled Runtime Error|Application error/);
      if (c.audience === "buyer") {
        expect(body, "a buyer's dead link must not name the product").not.toMatch(/closecheck/i);
        expect(
          await page.locator('a[href^="/engagements"], a[href^="/login"], a[href^="/signup"]').count(),
          "a buyer's dead link must offer no route into the consultant app",
        ).toBe(0);
      }
      await page.close();
    }
  }, 120_000);
});
