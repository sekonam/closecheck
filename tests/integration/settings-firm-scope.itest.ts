import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchBrowser, requireServer } from "./helpers/browser";
import { BASE_URL } from "./helpers/http";

/**
 * What the settings page actually shows each role.
 *
 * Server-side enforcement landed first and the page kept rendering the branding, logo and
 * disclaimer controls to everyone — so a member filled in the form, submitted, and was refused. A
 * control that presents itself and then refuses is the same failure as a message instructing
 * someone who cannot act.
 *
 * Asserted by signing in as each role against the running app rather than by unit-testing a
 * predicate: the status of each control was never wrong, only what was drawn from it, and that is
 * invisible to anything that does not render the page.
 */

const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `Settings Scope ${suffix}`;
const PASSWORD = "correct-horse-battery-staple-9";
const OWNER_EMAIL = `owner-${suffix}@itest.invalid`;
const MEMBER_EMAIL = `member-${suffix}@itest.invalid`;

let browser: Browser;
let orgId: string;

type SettingsView = { text: string; controls: number };

async function settingsPageAs(email: string): Promise<SettingsView> {
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/engagements/, { timeout: 30_000 }),
      page.locator('form:has(input[name="password"]) button[type="submit"]').click(),
    ]);
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
    // Counted from the DOM, not from the text: a section HEADING survives for a member (they still
    // need to see what the firm's branding is), so asserting on rendered words would have passed
    // for the wrong reason. What must not survive is a control that submits and is refused.
    const controls = await page
      .locator(
        'form[action] input[name="name"], form[action] input[name="brandColorHex"], ' +
          'form[action] input[type="file"], form[action] button:has-text("reviewed this language")',
      )
      .count();
    return { text: (await page.innerText("body")).replace(/\s+/g, " "), controls };
  } finally {
    await page.close();
  }
}

beforeAll(async () => {
  await requireServer();
  browser = await launchBrowser();

  const hash = await bcrypt.hash(PASSWORD, 10);
  const org = await directPrisma.consultantOrg.create({
    data: { name: ORG_NAME, brandColorHex: "#0d7a6f" },
  });
  orgId = org.id;
  await directPrisma.user.createMany({
    data: [
      { orgId, email: OWNER_EMAIL, passwordHash: hash, role: "OWNER", name: "The Owner" },
      { orgId, email: MEMBER_EMAIL, passwordHash: hash, role: "MEMBER", name: "A Member" },
    ],
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await directPrisma.consultantOrg.delete({ where: { id: orgId } }).catch(() => {});
  await directPrisma.$disconnect();
});

describe("the settings page", () => {
  it("offers the owner the firm-scoped controls", async () => {
    const { text, controls } = await settingsPageAs(OWNER_EMAIL);
    expect(controls, "the owner was not offered the firm-scoped controls").toBeGreaterThan(0);
    expect(text).toMatch(/I've reviewed this language/);
    expect(text).not.toContain("Your account owner sets");
  });

  it("does not offer a member a control that would refuse them", async () => {
    const { text, controls } = await settingsPageAs(MEMBER_EMAIL);
    expect(controls, "a firm-scoped control was rendered to a member").toBe(0);
    expect(text).not.toMatch(/I've reviewed this language/);
  });

  it("still shows a member what the firm's branding IS, and who sets it", async () => {
    // Hiding the information as well as the control would be the worse failure: a member needs to
    // know what appears on the reports they produce, and why a report they cannot generate is
    // blocked.
    const { text: body } = await settingsPageAs(MEMBER_EMAIL);
    expect(body).toContain(ORG_NAME);
    expect(body).toContain("#0d7a6f");
    expect(body).toContain("Your account owner sets the firm's name and colour");
    expect(body).toContain("Your account owner sets the firm's logo");
    expect(body).toContain("before anyone in the firm can generate a report");
  });

  it("shows neither role this product's own section numbers", async () => {
    for (const email of [OWNER_EMAIL, MEMBER_EMAIL]) {
      const { text } = await settingsPageAs(email);
      expect(text, email).not.toMatch(/spec\.md|roadmap\.md|§\d/);
    }
  });
});
