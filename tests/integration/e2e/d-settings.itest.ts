import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type Browser, type Page } from "playwright";
import { BASE_URL } from "../helpers/http";
import { collectPageErrors, launchBrowser, requireServer, submitExpectingRefusal } from "../helpers/browser";
import type { Locator } from "playwright";
import { directPrisma } from "../helpers/fixtures";

/**
 * The SERVER's billing configuration, as far as this process can tell: the job env in CI, .env
 * locally (loadEnv). Rows that need Stripe test keys on the server skip with this reason rather
 * than fail — CI has no Stripe secrets by design, and a skip that names why is honest where a
 * silent pass would not be.
 */
const SERVER_BILLING_CONFIGURED = !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;

/**
 * E2E plan area D (docs/qa/e2e-plan-2026-09-25.md), rows D1–D4: what a signed-in OWNER actually
 * sees and can do on the settings page — billing in Stripe test mode with enforcement off, API keys
 * created and revoked through the UI and exercised against the real v1 API, webhook endpoints, and
 * the retention date an engagement acquires when it reaches a terminal stage. Everything runs
 * through the real browser against the running server; nothing is asserted on inspection.
 */
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `E2E-D Settings ${suffix}`;
const EMAIL = `e2e-d-${suffix}@example.com`;
const PASSWORD = `E2eD-${suffix}-pass!`;
const DINER = `E2E-D Diner ${suffix}`;


/** helpers/browser.submitAndSettle with a budget that survives a shared, loaded dev server. */
async function submitAndSettle(page: Page, locator: Locator): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 120_000 }),
    locator.click(),
  ]);
}

describe("area D — settings, integrations and retention through the UI", () => {
  let browser: Browser;
  let page: Page;
  let pageErrors: ReturnType<typeof collectPageErrors>;
  let orgId: string;
  let engagementId: string;
  let auditId: string;

  beforeAll(async () => {
    await requireServer();
    browser = await launchBrowser();
    page = await browser.newPage();
    pageErrors = collectPageErrors(page);
    // The dev server is shared with three other drivers and the founder's browser during this run;
    // a page can legitimately take a minute to answer. Playwright's 30s defaults would report the
    // load as a product failure.
    page.setDefaultTimeout(120_000);
    page.setDefaultNavigationTimeout(120_000);

    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="orgName"]', ORG_NAME);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirmPassword"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 60_000 }),
      page.locator('form:has(input[name="orgName"]) button[type="submit"]').click(),
    ]);
    const org = await directPrisma.consultantOrg.findFirstOrThrow({ where: { name: ORG_NAME } });
    orgId = org.id;

    // An engagement and an audit, through the UI, for the credit notice and the webhook trigger.
    await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
    const newEngagement = page.locator('form:has(input[name="businessName"])');
    await newEngagement.locator('input[name="businessName"]').fill(DINER);
    await newEngagement.locator('input[name="primaryDomain"]').fill("example.com");
    await submitAndSettle(page, newEngagement.locator('button[type="submit"]'));
    const engagement = await directPrisma.engagement.findFirstOrThrow({ where: { businessName: DINER } });
    engagementId = engagement.id;
    await page.goto(`${BASE_URL}/engagements/${engagementId}`, { waitUntil: "domcontentloaded" });
    const startAudit = page.locator('form:has(select[name="templateSlug"])');
    await submitAndSettle(page, startAudit.locator('button[type="submit"]'));
    const audit = await directPrisma.audit.findFirstOrThrow({ where: { engagementId } });
    auditId = audit.id;
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    if (orgId) await directPrisma.consultantOrg.delete({ where: { id: orgId } }).catch(() => {});
    await directPrisma.$disconnect();
  });

  it.skipIf(!SERVER_BILLING_CONFIGURED)("D1: billing shows test-mode plan state, enforcement-off wording, and checkout reaches Stripe", async () => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const body = await page.innerText("body");
    expect(body).toContain("Plan & billing");
    expect(body).toContain("No plan");
    expect(body).toMatch(/Audit credits:\s*0/);
    expect(body).toContain("enforcement off — nothing is blocked yet");

    // The audit page is where a consultant learns what a full audit costs them; with zero credits
    // and enforcement off it must say "recorded but not billed yet", not something read as a charge.
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const auditBody = await page.innerText("body");
    expect(auditBody).toContain("Tier A screening is included in your plan");
    expect(auditBody).toContain("None remaining. Overage is being recorded but not billed yet.");
    expect(auditBody).not.toContain("billed as an overage");

    // Checkout: a real Stripe TEST-mode Checkout Session is created and the browser is sent to it.
    // Never completed here.
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const solo = page.locator('form:has(input[name="plan"][value="SOLO_MONTHLY"]) button[type="submit"]');
    expect(await solo.count()).toBe(1);
    await Promise.all([
      page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 }),
      solo.click(),
    ]);
    expect(page.url()).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  }, 120_000);

  it("D2: an API key created in the UI works against /api/v1, and stops working when revoked in the UI", async () => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const createForm = page.locator('form:has(input[placeholder^="Key name"])');
    await createForm.locator('input[name="name"]').fill(`e2e-d ${suffix}`);
    await submitAndSettle(page, createForm.locator('button[type="submit"]'));

    const reveal = page.locator('div:has(> p:text("Your new API key")) p.font-mono');
    await reveal.waitFor({ state: "visible", timeout: 15_000 });
    const token = (await reveal.textContent())?.trim() ?? "";
    expect(token).toMatch(/^cc_live_/);
    expect(await page.innerText("body")).toContain("Shown once");

    const ok = await fetch(`${BASE_URL}/api/v1/engagements`, { headers: { authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    const listed = (await ok.json()) as { engagements?: { id: string }[] };
    expect(listed.engagements?.some((e) => e.id === engagementId), "the key must see this org's engagement").toBe(true);

    // "Shown once" has to mean once: after a reload the list shows the prefix only, never the token
    // (it used to replay the plaintext for the reveal cookie's whole lifetime), and "never used"
    // flips once used. RevealOnce expires the cookie via a server action fired on mount, and a
    // reload CANCELS an in-flight action (the repo's documented trap) — so wait for the network to
    // settle before reloading, or the cookie survives and the reveal legitimately re-renders.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);
    const listBody = await page.innerText("body");
    expect(listBody).not.toContain(token);
    expect(listBody).toMatch(/last used \d{4}-\d{2}-\d{2}/);

    const revoke = page.locator(`form:has(input[name="apiKeyId"]) button:has-text("Revoke")`).first();
    await submitAndSettle(page, revoke);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await page.innerText("body")).toMatch(/revoked \d{4}-\d{2}-\d{2}/);

    const gone = await fetch(`${BASE_URL}/api/v1/engagements`, { headers: { authorization: `Bearer ${token}` } });
    expect(gone.status).toBe(401);
  }, 120_000);

  it("D3: the UI refuses a local/non-https endpoint, accepts a public one, and a real dispatch records its outcome", async () => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const addForm = page.locator('form:has(input[name="url"][type="url"])');

    // By design (SSRF guard), an endpoint on localhost / a private network / plain http is refused
    // — so "point it at a local listener" is not a path the product allows. The refusal is the test.
    await addForm.locator('input[name="url"]').fill("http://127.0.0.1:9/hook");
    await submitExpectingRefusal(page, addForm.locator('button[type="submit"]'));
    expect(await page.innerText("body")).toContain("publicly reachable");
    expect(await directPrisma.webhookEndpoint.count({ where: { orgId } })).toBe(0);

    // A public https endpoint is accepted and its signing secret shown exactly once.
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const target = `https://example.com/closecheck-e2e-${suffix}`;
    await addForm.locator('input[name="url"]').fill(target);
    await submitAndSettle(page, addForm.locator('button[type="submit"]'));
    const secretBox = page.locator('div:has(> p:text("Signing secret for your new endpoint")) p.font-mono');
    await secretBox.waitFor({ state: "visible", timeout: 15_000 });
    const shownSecret = (await secretBox.textContent())?.trim() ?? "";
    expect(shownSecret).toMatch(/^whsec_/);
    // "Shown once" has to mean once: a reload must not show it again. Same consume-action race as
    // the API-key reveal above: let the expiry action's response land before reloading.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);
    expect(await page.innerText("body")).not.toContain(shownSecret);
    const endpoint = await directPrisma.webhookEndpoint.findFirstOrThrow({ where: { orgId, url: target } });
    expect(endpoint.lastSuccessAt).toBeNull();
    expect(endpoint.lastFailureAt).toBeNull();

    // Trigger a real event through the UI: marking the audit complete dispatches audit.completed to
    // the endpoint. example.com answers 404, so the delivery fails after three attempts and the
    // failure — not silence — is what the settings page must then show. (Payload shape is pinned by
    // tests/integration/webhook-payload.itest.ts at the fetch boundary; this proves the UI → dispatch
    // → outcome path with a real network hop.)
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const completes = page.locator("form").filter({ has: page.locator("button", { hasText: /mark.*complete/i }) });
    expect(await completes.count(), "expected exactly one mark-complete control on the audit page").toBe(1);
    await submitAndSettle(page, completes.first().locator('button[type="submit"]'));
    const audit = await directPrisma.audit.findUniqueOrThrow({ where: { id: auditId } });
    expect(audit.status).toBe("COMPLETE");

    let recorded = null as null | { lastFailureAt: Date | null; lastFailureReason: string | null; lastSuccessAt: Date | null };
    for (let i = 0; i < 40; i++) {
      recorded = await directPrisma.webhookEndpoint.findUniqueOrThrow({
        where: { id: endpoint.id },
        select: { lastFailureAt: true, lastFailureReason: true, lastSuccessAt: true },
      });
      if (recorded.lastFailureAt || recorded.lastSuccessAt) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    // What this row proves is UI → dispatch → recorded outcome. Which outcome depends on a third
    // party (example.com answers 4xx today; a 200, a timeout, or new status text is theirs, not
    // ours), so accept either — but whichever it was must be recorded and must reach the page.
    expect(
      recorded?.lastFailureAt ?? recorded?.lastSuccessAt,
      "dispatch never recorded an outcome",
    ).toBeInstanceOf(Date);
    if (recorded?.lastFailureAt) {
      expect(recorded.lastFailureReason, "a failure was recorded with no reason").toBeTruthy();
    }

    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    expect(await page.innerText("body")).toMatch(
      recorded?.lastFailureAt ? /last failure \d{4}-\d{2}-\d{2}/ : /last delivered \d{4}-\d{2}-\d{2}/,
    );
  }, 150_000);

  it("D4: moving an engagement to a terminal stage sets the documented retention date", async () => {
    await page.goto(`${BASE_URL}/engagements/${engagementId}`, { waitUntil: "domcontentloaded" });
    const edit = page.locator('form:has(select[name="dealStage"])');
    expect(await edit.locator('input[name="documentPurgeAt"]').inputValue()).toBe("");
    await edit.locator('select[name="dealStage"]').selectOption("CLOSED");
    await submitAndSettle(page, edit.locator('button[type="submit"]'));

    await page.reload({ waitUntil: "domcontentloaded" });
    const shown = await page.locator('input[name="documentPurgeAt"]').inputValue();
    const expected = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const dayBefore = new Date(Date.now() + 89 * 86_400_000).toISOString().slice(0, 10);
    const dayAfter = new Date(Date.now() + 91 * 86_400_000).toISOString().slice(0, 10);
    expect([dayBefore, expected, dayAfter], `purge date ${shown} is not ~90 days out`).toContain(shown);
    const engagement = await directPrisma.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    expect(engagement.dealStage).toBe("CLOSED");
    expect(engagement.documentPurgeAt).toBeInstanceOf(Date);
  }, 60_000);

  it("logged no console or page errors across the whole area", () => {
    expect(pageErrors.significant()).toEqual([]);
  });
});
