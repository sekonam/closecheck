import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";
import type { Browser, Locator, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  collectPageErrors,
  launchBrowser,
  requireServer,
  submitAndSettle,
  submitExpectingRefusal,
} from "./helpers/browser";
import { BASE_URL } from "./helpers/http";

/**
 * The consultant's actual working surface: taking an audit, attaching evidence, citing the clause a
 * structured answer came from, and being shown what this firm found the last time it looked at the
 * same vendor.
 *
 * These behaviours were each verified in a real browser when they were built — and by throwaway
 * scripts that were then deleted, so nothing held them. That is a worse state than not having
 * checked, because the commit messages assert verification and tell the next reader not to bother.
 * This file is those checks made durable.
 *
 * Deliberately UI-driven rather than built on `fixtures.ts`: the consultant's path through the
 * product IS what is under test here, so routing around engagement and audit creation to save time
 * would hollow out the thing being asserted.
 */

const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `E2E Workflow ${suffix}`;
const EMAIL = `e2e-workflow-${suffix}@itest.invalid`;
const PASSWORD = "correct-horse-battery-staple-9";

/** The base Tier B item every template carries, and the one with the richest field schema. */
const CONTRACT_ITEM = "Primary business-system contract terms";
const CONTRACT_CARD = `div.rounded-lg:has-text("${CONTRACT_ITEM}")`;

/** Template v4's recurring-SaaS inventory — the only `table`-kind field in the library. */
const SAAS_TABLE_INPUT = 'input[name="field_tools_0_tool"]';

let browser: Browser;
let page: Page;
let pageErrors: ReturnType<typeof collectPageErrors>;
let tempDir: string;
let realPdf: string;
let notReallyAPdf: string;

/** Creates an engagement and starts an audit through the UI, returning the audit's URL. */
async function startAudit(businessName: string): Promise<string> {
  await page.goto(`${BASE_URL}/engagements`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="businessName"]', businessName);
  // Scoped to the form: the app chrome's "Sign out" is also a submit button and comes first in
  // the DOM, so an unscoped click silently ends the session.
  await Promise.all([
    page.waitForURL(/\/engagements\/[a-z0-9]+/, { timeout: 30_000 }),
    page.locator('form:has(input[name="businessName"]) button[type="submit"]').click(),
  ]);

  await page.selectOption('select[name="templateSlug"]', "restaurant-online-ordering");
  await Promise.all([
    page.waitForURL(/\/audits\//, { timeout: 30_000 }),
    page.locator('form:has(select[name="templateSlug"]) button[type="submit"]').click(),
  ]);
  return page.url();
}

/** The finding form inside a given item's card — not the evidence or citation forms. */
function findingForm(cardSelector: string): Locator {
  return page.locator(cardSelector).first().locator('form:has(select[name="status"])').first();
}

describe("the consultant's audit-taking workflow", () => {
  let auditUrl: string;

  beforeAll(async () => {
    await requireServer();
    browser = await launchBrowser();
    page = await browser.newPage();
    pageErrors = collectPageErrors(page);

    tempDir = await mkdtemp(join(tmpdir(), "closecheck-itest-"));
    realPdf = join(tempDir, "toast-msa-2023.pdf");
    notReallyAPdf = join(tempDir, "claims-to-be.pdf");
    // A minimal but genuine PDF: the upload path checks the file's own leading bytes against the
    // type it claims, so a fixture that merely ends in .pdf would be refused for the right reason
    // and prove nothing about the accept path.
    await writeFile(realPdf, "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    await writeFile(notReallyAPdf, "this is not a pdf");

    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="orgName"]', ORG_NAME);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirmPassword"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 30_000 }),
      page.locator('form:has(input[name="orgName"]) button[type="submit"]').click(),
    ]);

    auditUrl = await startAudit(`Harbour Street Bistro ${suffix}`);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    // Cascades remove every engagement, audit, finding, evidence row and vendor reading beneath it.
    const org = await directPrisma.consultantOrg.findFirst({ where: { name: ORG_NAME } });
    if (org) await directPrisma.consultantOrg.delete({ where: { id: org.id } }).catch(() => {});
    await directPrisma.$disconnect();
  });

  it("serves the published template version, not an earlier one", async () => {
    // Doubles as a publish check. An install that stops at v2 has the code but templates declaring
    // no field schema, so every Tier B item silently falls back to note-only — which looks like the
    // evidence-capture feature is broken rather than unpublished, the worst kind to debug.
    const body = await page.innerText("body");
    expect(body, "v4 split live-login item missing").toContain("Live login to the primary operating system");
    expect(body, "v4 split live-login item missing").toContain("Live login to listing and social accounts");
    expect(body, "the retired v2 bundled item is still being served").not.toContain(
      "Live login to POS/booking/GBP/socials",
    );
  });

  it("captures a table field, and canonicalises money on the way in", async () => {
    const form = page.locator(`form:has(${SAAS_TABLE_INPUT})`).first();
    await form.locator(SAAS_TABLE_INPUT).fill("Mailchimp");
    await form.locator('input[name="field_tools_0_monthlyCost"]').fill("$20.50");
    await form.locator('input[name="field_tools_1_tool"]').fill("Canva");
    await submitAndSettle(page, form.locator('button[type="submit"]'));

    // Re-navigate before asserting: reading an input straight after a server action can return the
    // text that was typed rather than what was stored, which is the opposite of "persisted".
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    expect(await page.locator(SAAS_TABLE_INPUT).inputValue()).toBe("Mailchimp");
    expect(
      await page.locator('input[name="field_tools_0_monthlyCost"]').inputValue(),
      "money was stored as typed rather than canonicalised",
    ).toBe("20.50");
    expect(await page.locator('input[name="field_tools_1_tool"]').inputValue()).toBe("Canva");

    // A blank row must reappear, or rows can never be added again without client-side JS.
    expect(
      await page.locator('input[name="field_tools_2_tool"]').count(),
      "no blank row offered after saving",
    ).toBe(1);
  });

  it("refuses a Red finding with no note", async () => {
    // spec.md §4's severity model. An unexplained Red is the finding a buyer pushes back on
    // hardest, and the consultant has to be able to answer.
    const form = findingForm(CONTRACT_CARD);
    await form.locator('select[name="severity"]').selectOption("RED");
    await form.locator('input[name="note"]').fill("");
    await submitExpectingRefusal(page, form.locator('button[type="submit"]'));
    expect(await page.textContent("body")).toContain("Red finding needs a note");
  });

  it("flags a rating with no evidence behind it, at item and audit level", async () => {
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const form = findingForm(CONTRACT_CARD);
    await form.locator('select[name="severity"]').selectOption("GREEN");
    await submitAndSettle(page, form.locator('button[type="submit"]'));

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const body = (await page.innerText("body")).replace(/\s+/g, " ");
    expect(body, "a Tier B item rated with no document was not flagged").toContain("Rated with no document");
    expect(body, "the audit-level unsupported-rating warning did not appear").toMatch(
      /rated with no document or attestation behind/i,
    );
  });

  it("records what a document is and who provided it", async () => {
    const card = page.locator(CONTRACT_CARD).first();
    const form = card.locator('form:has(input[type="file"])').first();
    await form.locator('input[type="file"]').setInputFiles(realPdf);
    await form.locator('input[name="label"]').fill("Toast MSA, executed");
    await submitAndSettle(page, form.locator('button:has-text("Attach")'));

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const body = (await page.innerText("body")).replace(/\s+/g, " ");
    expect(body).toContain("Toast MSA, executed");
    // The real filename stays alongside the label: a seller's scanner-generated name is often the
    // only way to match a document against what was actually sent.
    expect(body).toContain("toast-msa-2023.pdf");
    expect(body, "provenance line missing type, size or attributor").toMatch(
      /PDF · \d+ B · added by .+ on \d{4}-\d{2}-\d{2}/,
    );
    expect(body, "the evidence-expectation chip did not flip once a document existed").toContain(
      "Document attached",
    );
  });

  it("refuses a file whose contents do not match its declared type", async () => {
    // `file.type` is an assertion by the uploader, not a fact.
    const form = page.locator(CONTRACT_CARD).first().locator('form:has(input[type="file"])').first();
    await form.locator('input[type="file"]').setInputFiles(notReallyAPdf);
    await submitExpectingRefusal(page, form.locator('button:has-text("Attach")'));
    expect(await page.textContent("body")).toContain("don't match");
  });

  it("cites the clause a structured answer came from", async () => {
    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const card = page.locator(CONTRACT_CARD).first();
    const block = card.locator('details:has(input[name="fieldKey"][value="transferable"])').first();
    await block.locator("summary").click();
    const form = block.locator("form").first();
    await form.locator('input[name="locator"]').fill("§14.2, p.7");
    await form
      .locator('textarea[name="excerpt"]')
      .fill("This Agreement may not be assigned without Toast's prior written consent.");
    await submitAndSettle(page, form.locator('button:has-text("Save source")'));

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    const body = (await page.innerText("body")).replace(/\s+/g, " ");
    expect(body, "citation not rendered against its field").toContain("§14.2, p.7 of Toast MSA, executed");
    expect(body).toContain("may not be assigned");
  });

  it("removes a citation when both fields are cleared", async () => {
    const block = page
      .locator(CONTRACT_CARD)
      .first()
      .locator('details:has(input[name="fieldKey"][value="transferable"])')
      .first();
    await block.locator("summary").click();
    const form = block.locator("form").first();
    await form.locator('input[name="locator"]').fill("");
    await form.locator('textarea[name="excerpt"]').fill("");
    await submitAndSettle(page, form.locator('button:has-text("Save source")'));

    await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
    expect(await page.innerText("body")).not.toContain("§14.2, p.7");
  });

  describe("vendor memory across two engagements", () => {
    let secondAuditUrl: string;

    it("recalls the previous engagement, and flags where this contract differs", async () => {
      // Record a vendor and its terms on the first deal.
      await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
      const first = findingForm(CONTRACT_CARD);
      await first.locator('input[name="field_vendor"]').fill("Toast, Inc.");
      await first.locator('select[name="field_transferable"]').selectOption("does-not-transfer");
      await first.locator('input[name="field_penaltyAmount"]').fill("$4,800");
      await submitAndSettle(page, first.locator('button[type="submit"]'));

      // The recording audit must not show its own answer back as a previous engagement.
      await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
      expect(
        await page.innerText("body"),
        "an audit recalled its own reading as a previous engagement",
      ).not.toMatch(/you audited Toast/i);

      // A second deal, same vendor, a different penalty.
      secondAuditUrl = await startAudit(`Old Mill Taproom ${suffix}`);
      const second = findingForm(CONTRACT_CARD);
      await second.locator('input[name="field_vendor"]').fill("toast pos");
      await second.locator('select[name="field_transferable"]').selectOption("does-not-transfer");
      await second.locator('input[name="field_penaltyAmount"]').fill("$9,600");
      await submitAndSettle(page, second.locator('button[type="submit"]'));

      await page.goto(secondAuditUrl, { waitUntil: "domcontentloaded" });
      const body = (await page.innerText("body")).replace(/\s+/g, " ");

      // "toast pos" and "Toast, Inc." are one vendor: the normaliser strips corporate suffixes and
      // category words, which is what makes the recall fire at all here.
      expect(body, "recall panel not shown for the same vendor spelled differently").toMatch(
        /you audited .* before/i,
      );
      expect(body, "recall did not name the engagement it came from").toContain(
        `Harbour Street Bistro ${suffix}`,
      );
      expect(body, "recall did not show the previously recorded penalty").toContain("$4,800.00");
      expect(body, "a divergent answer between the two deals was not flagged").toMatch(
        /answers? differs?/i,
      );
    });

    it("offers no control that could write a recalled value into the finding", async () => {
      // The durable form of a product decision that would otherwise erode. A prefilled value is
      // indistinguishable, in this form and then in the generated report, from one the consultant
      // read out of THIS deal's contract — so a "use this" control would let the previous deal's
      // termination penalty ship to this buyer as a finding about their target, with the
      // consultant's name and a severity on it.
      //
      // Asserted specifically rather than as "no buttons", so a future change that adds one has to
      // consciously delete a test that explains why, rather than watch a vague selector quietly
      // stop matching.
      // Scoped to the panel's own container, not `div:has-text(...)`. That selector matches every
      // ancestor div containing the phrase, and `.last()` picks the innermost — a label wrapper
      // holding no controls — so the assertion passed with a "use this" button sitting in the
      // panel. Demonstrated: with that button reintroduced, this version goes red and the earlier
      // version stayed green.
      const panel = page.locator("div.rounded-md.bg-slate-50", { hasText: "You audited" }).first();
      expect(await panel.count(), "the recall panel itself was not found").toBe(1);
      const populating = await panel
        .locator('button, input:not([type="hidden"]), select, textarea, [role="button"], a[href]')
        .count();
      expect(
        populating,
        "the vendor recall panel gained a control that could populate a field — see " +
          "src/lib/audit/vendorMemory.ts for why it must not",
      ).toBe(0);
    });
  });

  it("logged no page errors across the whole workflow", async () => {
    // A page that renders but logs a hydration or server-action error is broken in a way no
    // assertion above can see.
    expect(pageErrors.significant()).toEqual([]);
  });
});
