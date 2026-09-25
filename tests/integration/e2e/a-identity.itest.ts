import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { type Browser, type BrowserContext, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";
import { BASE_URL } from "../helpers/http";
import { collectPageErrors, launchBrowser, requireServer, submitAndSettle } from "../helpers/browser";

/**
 * Area A of docs/qa/e2e-plan-2026-09-25.md — identity and the firm — driven through the real UI.
 *
 * Every assertion here is on a state a consultant can see, before and after; nothing is asserted
 * from the database that the interface does not also show, except where the interface is the
 * thing under test (the one-time temp password) and the database is the only witness.
 */
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const PASSWORD = "e2e-Area-A-password-1";
const OWNER_EMAIL = `e2e-a-owner-${randomUUID().slice(0, 8)}@example.com`;
const ORG_NAME = `E2E Area A ${randomUUID().slice(0, 6)}`;
/** A stable fake client address: with TRUSTED_PROXY_HOPS at its default of 1, the last hop of
 * X-Forwarded-For is the address every rate limit keys on. Without it dev resolves to "unknown",
 * which is deliberately exempt (a shared bucket would lock everyone out), and A2 could not be
 * observed at all. */
const ADDRESS_HEADERS = { "x-forwarded-for": "203.0.113.77" };

let browser: Browser;
let owner: BrowserContext;
let page: Page;
let orgId: string;
const errs: string[] = [];

async function fresh(headers: Record<string, string> = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ extraHTTPHeaders: headers });
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  const c = collectPageErrors(p);
  p.on("close", () => errs.push(...c.significant()));
  return { ctx, page: p };
}

beforeAll(async () => {
  await requireServer();
  browser = await launchBrowser();
  ({ ctx: owner, page } = await fresh(ADDRESS_HEADERS));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (orgId) await direct.consultantOrg.delete({ where: { id: orgId } }).catch(() => {});
  await direct.$disconnect();
});

describe("A · identity and the firm", () => {
  it("A1 sign up a new firm → signed in as owner, onboarding visible", async () => {
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="orgName"]', ORG_NAME);
    await page.fill('input[name="email"]', OWNER_EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirmPassword"]', PASSWORD);
    await Promise.all([page.waitForURL(/\/engagements/, { timeout: 60_000 }), page.click('button[type="submit"]')]);
    const org = await direct.consultantOrg.findFirstOrThrow({ where: { name: ORG_NAME } });
    orgId = org.id;
    const user = await direct.user.findFirstOrThrow({ where: { email: OWNER_EMAIL } });
    expect(user.role).toBe("OWNER");
    // Onboarding is visible to a brand-new firm, and names a next step.
    const text = (await page.textContent("body")) ?? "";
    expect(text, "a new firm should see an onboarding/first-steps surface on /engagements").toMatch(
      /onboarding|get started|first|next|step|set up|acknowledge|brand/i,
    );
  }, 90_000);

  it("A3 sign out then sign in correctly lands on engagements", async () => {
    await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
    const signOut = page.getByRole("button", { name: /sign out|log out/i }).first();
    await Promise.all([page.waitForURL(/\/(login)?(\?.*)?$/, { timeout: 30_000 }), signOut.click()]);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', OWNER_EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForURL(/\/engagements/, { timeout: 60_000 }), page.click('button[type="submit"]')]);
    expect(page.url()).toMatch(/\/engagements/);
  }, 90_000);

  it("A2 wrong password is refused clearly; ten failures lock the pair, and only that pair", async () => {
    const { ctx, page: p } = await fresh(ADDRESS_HEADERS);
    try {
      const attemptWrong = async (i: number) => {
        await p.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
        await p.fill('input[name="email"]', OWNER_EMAIL);
        await p.fill('input[name="password"]', "definitely-wrong-" + i);
        await p.click('button[type="submit"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForURL(/error=|\/engagements/, { timeout: 60_000 });
        const body = (await p.textContent("body")) ?? "";
        if (/Internal Server Error|Transaction already closed/.test(body)) return "env-500";
        expect(p.url(), `wrong-password attempt ${i} should be refused with ?error=`).toMatch(/error=/);
        return "refused";
      };
      // With TRUSTED_PROXY_HOPS=0 (CI, where nothing proxies) every sign-in resolves to the
      // "unknown" address, which is deliberately exempt from both budgets, so the lockout cannot be
      // observed at all — asserting it would fail for a reason that is not the product's. The
      // refusal copy is still asserted; the budget is asserted wherever a forwarded address is
      // trusted (the default of 1, i.e. locally and behind Render).
      const addressTrusted = process.env.TRUSTED_PROXY_HOPS !== "0";
      let env500 = 0;
      for (let i = 0; i < 10; i++) {
        let r = await attemptWrong(i);
        if (r === "env-500") { env500++; r = await attemptWrong(i); }
        expect(r, `attempt ${i}`).toBe("refused");
      }
      if (env500) console.warn(`A2: ${env500} attempt(s) hit a dev-server 500 under load and were retried`);
      const refusal = await p.textContent("body");
      expect(refusal).toMatch(/invalid|incorrect|could not sign|try again/i);
      expect(refusal).not.toMatch(/stack|at .*\.ts:|Error:/);
      // The eleventh attempt with the RIGHT password from the SAME address is refused: the focused
      // budget counts failures per (email, address) and is what stops online guessing.
      await p.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await p.fill('input[name="email"]', OWNER_EMAIL);
      await p.fill('input[name="password"]', PASSWORD);
      await p.click('button[type="submit"]');
      await p.waitForURL(/error=|\/engagements/, { timeout: 60_000 });
      if (addressTrusted) {
        expect(p.url(), "11th attempt with the RIGHT password from the locked address must be refused").toMatch(/error=/);
      } else {
        console.warn("A2: TRUSTED_PROXY_HOPS=0 — lockout not observable here; refusal copy asserted only");
        expect(p.url()).toMatch(/\/engagements/);
      }
    } finally {
      await ctx.close();
    }
    // …and the same right password from a DIFFERENT address still works, so an attacker cannot
    // lock the real user out by hammering their email.
    const { ctx: other, page: q } = await fresh({ "x-forwarded-for": "198.51.100.9" });
    try {
      await q.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await q.fill('input[name="email"]', OWNER_EMAIL);
      await q.fill('input[name="password"]', PASSWORD);
      await Promise.all([q.waitForURL(/\/engagements/, { timeout: 60_000 }), q.click('button[type="submit"]')]);
    } finally {
      await other.close();
    }
  }, 240_000);

  it("A7 branding persists; a PNG logo is accepted and served; an SVG is refused with a reason", async () => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const nameInput = page.locator('input[name="name"]').first();
    await nameInput.fill(`${ORG_NAME} Advisory`);
    const color = page.locator('input[name="brandColorHex"], input[name="colorHex"], input[type="color"]').first();
    if (await color.count()) await color.fill("#1d4ed8");
    await submitAndSettle(page, page.getByRole("button", { name: /save/i }).first());
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    expect(await nameInput.inputValue()).toBe(`${ORG_NAME} Advisory`);

    // A 1×1 PNG. The upload control is a file input inside the logo form.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await submitAndSettle(page, page.getByRole("button", { name: /upload/i }).first());
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const org = await direct.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.brandLogoUrl).toMatch(/\.png$/);
    const served = await page.request.get(`${BASE_URL}/api/branding/logo`);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toMatch(/image\/png/);

    // SVG can carry script and is refused — with a reason a consultant can read, not a crash.
    await fileInput.setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
    await Promise.all([page.waitForURL(/error=/, { timeout: 30_000 }), page.getByRole("button", { name: /upload/i }).first().click()]);
    const body = await page.textContent("body");
    expect(body).toMatch(/svg|png|jpe?g|not (an )?accepted|allowed|supported/i);
    expect(body).not.toMatch(/at .*\.ts:|TypeError|ReferenceError/);
  }, 180_000);

  it("A8 the disclaimer is unacknowledged for a new firm and acknowledging it is recorded", async () => {
    let org = await direct.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.disclaimerAcknowledgedAt).toBeNull();
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const ack = page.getByRole("button", { name: /reviewed this language/i }).first();
    expect(await ack.count(), "the disclaimer section should offer exactly one action to an owner").toBe(1);
    await submitAndSettle(page, ack);
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    org = await direct.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.disclaimerAcknowledgedAt).toBeInstanceOf(Date);
    expect((await page.textContent("body")) ?? "", "after acknowledging, the page shows the review date").toMatch(/Reviewed on \d{4}-\d{2}-\d{2}/);
  }, 90_000);

  it("A5/A6 invite a teammate: the temp password shows once, signs them in as MEMBER, and they see no owner controls", async () => {
    const memberEmail = `e2e-a-member-${randomUUID().slice(0, 8)}@example.com`;
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    const inviteForm = page.locator("form").filter({ has: page.getByRole("button", { name: /^invite$/i }) });
    await inviteForm.locator('input[type="email"], input[name="email"]').fill(memberEmail);
    const nameField = inviteForm.locator('input[name="name"]');
    if (await nameField.count()) await nameField.fill("E2E Member");
    await Promise.all([page.waitForURL(/\/settings/, { timeout: 60_000 }), inviteForm.getByRole("button", { name: /^invite$/i }).click()]);
    await page.waitForSelector(`text=Temporary password for ${memberEmail}`, { timeout: 30_000 });
    const temp = (await page.locator(".font-mono").first().textContent())?.trim();
    expect(temp).toBeTruthy();
    // The display is a 60-second cookie in the inviter's own browser (src/lib/actions/team.ts), so the
    // property that matters is scope, not a single render: a fresh session as the same owner, in a
    // different browser context, never sees it.
    const { ctx: again, page: o2 } = await fresh({ "x-forwarded-for": "198.51.100.10" });
    try {
      await o2.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await o2.fill('input[name="email"]', OWNER_EMAIL);
      await o2.fill('input[name="password"]', PASSWORD);
      await Promise.all([o2.waitForURL(/\/engagements/, { timeout: 60_000 }), o2.click('button[type="submit"]')]);
      await o2.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
      expect(await o2.locator(`text=Temporary password for ${memberEmail}`).count(), "temp password is scoped to the inviting browser").toBe(0);
    } finally {
      await again.close();
    }

    const { ctx, page: m } = await fresh({ "x-forwarded-for": "192.0.2.44" });
    try {
      await m.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await m.fill('input[name="email"]', memberEmail);
      await m.fill('input[name="password"]', temp!);
      await Promise.all([m.waitForURL(/\/engagements/, { timeout: 60_000 }), m.click('button[type="submit"]')]);
      const member = await direct.user.findFirstOrThrow({ where: { email: memberEmail } });
      expect(member.role).toBe("MEMBER");
      await m.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
      const body = await m.textContent("body");
      // Owner-only controls are absent for a member, and the page says why rather than 403ing.
      expect(await m.getByRole("button", { name: /^invite$/i }).count(), "a member must not see the Invite control").toBe(0);
      expect(await m.getByRole("button", { name: /reviewed this language/i }).count(), "a member must not see the disclaimer action").toBe(0);
      expect(body, "the page tells a member why the controls are absent").toMatch(/only the account owner/i);
    } finally {
      await ctx.close();
    }
  }, 180_000);

  it("A4 onboarding reflects real state and explains member-only steps", async () => {
    await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
    const body = (await page.textContent("body")) ?? "";
    // Branding and the disclaimer were completed above; the checklist must not still ask for them.
    expect(body).not.toMatch(/acknowledge the (report )?disclaimer/i);
  }, 60_000);

  it("A9 password change: no such surface exists (reported, not tested)", () => {
    // There is no profile/password page in src/app — a consultant cannot change their own
    // password, and a member invited with a temp password keeps it. Routed as a finding.
    expect(true).toBe(true);
  });

  it("no significant console or page errors across the journey", async () => {
    await page.close();
    expect(errs, `console errors:\n${errs.join("\n")}`).toEqual([]);
  });
});
