import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { type Browser, type Page, type Locator } from "playwright";
import { PrismaClient } from "@prisma/client";
import { BASE_URL } from "../helpers/http";
import { collectPageErrors, launchBrowser, requireServer } from "../helpers/browser";
import { createOrgFixture, destroyOrgFixture, type OrgFixture } from "../helpers/fixtures";
import { objectExists } from "@/lib/storage/objectStore";

/**
 * E2E plan area C (docs/qa/e2e-plan-2026-09-25.md): reports, PDF export, portal links, the buyer's
 * portal, the access and export trails, and cross-tenant reach through URLs — driven through the
 * real UI in a real browser against the running server.
 *
 * Setup that is not under test (the firm, its engagement, its audit, its findings) is written
 * directly, as the fixtures do; everything being tested — generate, download, share, view as a
 * stranger, revoke — goes through the page a consultant uses or the URL a buyer receives. Every
 * assertion has a before-state, so a step that silently did nothing cannot pass.
 */
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `E2E C Reports ${suffix}`;
const EMAIL = `e2e-c-${suffix}@itest.invalid`;
const PASSWORD = "correct-horse-battery-staple-9";

/** Report generation renders with headless Chromium: far longer than submitAndSettle's 30s under load. */
async function submitAndSettleSlow(page: Page, locator: Locator, timeout = 150_000): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout }),
    locator.click(),
  ]);
}

/** Body text with every <details> opened first — the trails are disclosure elements, and innerText
 * omits collapsed content, so reading without opening would miss exactly the rows under test. */
async function bodyTextWithDetailsOpen(page: Page): Promise<string> {
  await page.$$eval("details", (nodes) => nodes.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  return page.innerText("body");
}

describe("C · reports, portal and trails through the real UI", () => {
  let browser: Browser;
  let page: Page;
  let pageErrors: ReturnType<typeof collectPageErrors>;
  let orgId: string;
  let userId: string;
  let engagementId: string;
  let auditId: string;
  let other: OrgFixture;
  let firstReportId: string;
  let firstToken: string;
  let errorsBeforeC5 = 0;

  beforeAll(async () => {
    await requireServer();
    browser = await launchBrowser();
    page = await browser.newPage();
    // Four drivers share this dev server while the E2E plan runs; Playwright's 30s default is
    // tuned for an idle one. Generous, and applied once here rather than per call.
    page.setDefaultNavigationTimeout(240_000);
    page.setDefaultTimeout(240_000);
    pageErrors = collectPageErrors(page);
    other = await createOrgFixture("c-other");

    // A real session: sign up through the UI, as a consultant would.
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="orgName"]', ORG_NAME);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirmPassword"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 60_000 }),
      page.locator('form:has(input[name="orgName"]) button[type="submit"]').click(),
    ]);
    const org = await direct.consultantOrg.findFirstOrThrow({ where: { name: ORG_NAME } });
    orgId = org.id;
    userId = (await direct.user.findFirstOrThrow({ where: { orgId } })).id;

    // Not under test here (area A owns it): the disclaimer gate is satisfied directly.
    await direct.consultantOrg.update({ where: { id: orgId }, data: { disclaimerAcknowledgedAt: new Date() } });

    // An audit with one finding per template item, one of them rated Red with a note, so the
    // roll-up has something to compute and the PDF something to say.
    const template = await direct.template.findFirstOrThrow({
      where: { isActive: true },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const engagement = await direct.engagement.create({
      data: { orgId, businessName: `C Diner ${suffix}`, primaryDomain: `c-${suffix}.invalid` },
    });
    engagementId = engagement.id;
    const audit = await direct.audit.create({
      data: {
        orgId,
        engagementId,
        templateId: template.id,
        findings: {
          create: template.items.map((item, i) => ({
            orgId,
            templateItemId: item.id,
            status: i === 0 ? "FAIL" : "NOT_STARTED",
            severity: i === 0 ? "RED" : null,
            note: i === 0 ? `Domain is registered to the seller's nephew (${suffix})` : null,
          })),
        },
      },
    });
    auditId = audit.id;
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    if (other) await destroyOrgFixture(other.orgId);
    if (orgId) await direct.consultantOrg.delete({ where: { id: orgId } }).catch(() => {});
    await direct.$disconnect();
  }, 600_000);

  it("C1 · generates a report from the audit page: row, PDF object, roll-up from the findings", async () => {
    expect(await direct.report.count({ where: { auditId } })).toBe(0);
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const generate = page.locator('form:has(input[name="includeAppendix"]) button[type="submit"]');
    expect(await generate.isDisabled(), "generate button disabled although the disclaimer is acknowledged").toBe(false);
    await submitAndSettleSlow(page, generate);

    const report = await direct.report.findFirstOrThrow({ where: { auditId } });
    firstReportId = report.id;
    expect(report.computedOverallSeverity, "one Red finding must roll up to a Red report").toBe("RED");
    expect(report.pdfStorageKey, "report row committed without a PDF key").toBeTruthy();
    expect(await objectExists(orgId, report.pdfStorageKey!), "PDF key names an object that is not there").toBe(true);
    // The firm's name is snapshotted onto the report so the buyer's view cannot drift later.
    expect(report.brandSnapshotFirmName).toBe(ORG_NAME);

    // After the action's POST the page is still mid-refresh (Next's RSC round trip); a reload at
    // that instant is aborted. Navigate fresh instead.
    await page.waitForTimeout(2_000);
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const text = await page.innerText("body");
    expect(text).toContain("Download PDF");
    expect(text).toContain("Create client link");
  }, 600_000);

  it("C2/C7 · downloading the PDF records the export and shows it on the trail, before any share exists", async () => {
    expect(firstReportId, "C1 did not produce a report; nothing to export").toBeTruthy();
    expect(await direct.reportExportEvent.count({ where: { reportId: firstReportId } })).toBe(0);
    expect(await direct.clientPortalLink.count({ where: { reportId: firstReportId } })).toBe(0);

    const response = await page.request.get(`${BASE_URL}/api/reports/${firstReportId}/pdf`, { timeout: 120_000 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("pdf");
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const events = await direct.reportExportEvent.findMany({ where: { reportId: firstReportId } });
    expect(events, "exactly one export must be recorded for one download").toHaveLength(1);
    expect(events[0].exportedById).toBe(userId);
    expect(events[0].orgId).toBe(orgId);

    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const text = await bodyTextWithDetailsOpen(page);
    // The trail renders per report, so it has a place to render with no link in existence (C7).
    expect(text).not.toContain("/portal/");
    expect(text).not.toContain("Exports — none recorded");
    // The actor is named: no name was given at signup, so the email stands in.
    expect(text).toContain(`Downloaded by ${EMAIL}`);
  }, 600_000);

  it("C3 · a client link created on the page serves the report to a stranger under the firm's brand, and the view is logged unattributed", async () => {
    expect(firstReportId, "C1 did not produce a report; nothing to share").toBeTruthy();
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    await submitAndSettleSlow(page, page.getByRole("button", { name: /create client link/i }).first());
    const link = await direct.clientPortalLink.findFirstOrThrow({ where: { reportId: firstReportId } });
    firstToken = link.token;
    expect(link.createdById).toBe(userId);
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await direct.portalAccessLogEntry.count({ where: { linkId: link.id } })).toBe(0);

    const anonymous = await browser.newContext();
    try {
      const anon = await anonymous.newPage();
      anon.setDefaultNavigationTimeout(240_000);
      const anonErrors = collectPageErrors(anon);
      // The page embeds its PDF in an iframe whose fetch is one of the two DOCUMENT log rows
      // asserted below — register the wait before navigating, so the log query never races a
      // subresource that domcontentloaded does not wait for.
      const iframePdf = anon.waitForResponse((r) => r.url().includes("/pdf"), { timeout: 240_000 });
      const response = await anon.goto(`${BASE_URL}/portal/${link.token}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      expect((await iframePdf).status()).toBe(200);
      const shell = await anon.innerText("body");
      expect(shell).toContain(ORG_NAME);
      expect(shell.toLowerCase()).toContain("read-only");
      // spec.md §2 principle 4: the buyer sees the consultant's brand, never CloseCheck's.
      expect(shell, "CloseCheck's own name appears in the buyer-facing shell").not.toMatch(/closecheck/i);
      expect(await anon.title()).not.toMatch(/closecheck/i);

      const pdf = await anon.request.get(`${BASE_URL}/portal/${link.token}/pdf`, { timeout: 120_000 });
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
      expect(anonErrors.significant(), "console errors on the buyer's portal page").toEqual([]);
    } finally {
      await anonymous.close();
    }

    const log = await direct.portalAccessLogEntry.findMany({ where: { linkId: link.id }, orderBy: { viewedAt: "asc" } });
    // One page view; the document is fetched by the page's own iframe AND by the explicit request
    // above, so two document views is the correct count, not a double-log.
    expect(log.filter((e) => e.kind === "PAGE")).toHaveLength(1);
    expect(log.filter((e) => e.kind === "DOCUMENT")).toHaveLength(2);
    // The hash is of the client address. With TRUSTED_PROXY_HOPS=0 (CI, where nothing proxies) every
    // address is "unknown" and no hash is recorded — the configuration, not the product; behind
    // Render (hops=1) and locally the hash is asserted.
    if (process.env.TRUSTED_PROXY_HOPS !== "0") {
      for (const entry of log) expect(entry.ipHash, "a view must carry a hashed origin, not nothing").toBeTruthy();
    }

    await page.waitForTimeout(2_000);
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const text = await bodyTextWithDetailsOpen(page);
    expect(text).toContain(`/portal/${link.token}`);
    expect(text).toContain("Live");
    expect(text).toContain("Viewed");
    expect(text).toContain("Report downloaded");
    expect(text).toContain(`Sent by ${EMAIL}`);
  }, 600_000);

  it("C4 · a revoked link and an expired link both stop serving, without leaking anything", async () => {
    expect(firstToken, "C3 did not create a link; nothing to revoke").toBeTruthy();
    // A second, live link that will be expired directly rather than revoked.
    const expiring = await direct.clientPortalLink.create({
      data: { orgId, reportId: firstReportId, token: `e2e-c-exp-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    expect(await page.getByRole("button", { name: /^revoke$/i }).count()).toBe(2);
    // The revoke form for THIS link, by its hidden id — links list newest first, so "first button"
    // would revoke the other one.
    const firstLink = await direct.clientPortalLink.findUniqueOrThrow({ where: { token: firstToken } });
    // Two forms carry this link's hidden id — Revoke and "Email link" — so the button is named too.
    await submitAndSettleSlow(
      page,
      page.locator(`form:has(input[name="linkId"][value="${firstLink.id}"])`).getByRole("button", { name: /^revoke$/i }),
    );
    const revoked = await direct.clientPortalLink.findUniqueOrThrow({ where: { token: firstToken } });
    expect(revoked.revokedAt).toBeTruthy();
    expect(revoked.revokedById).toBe(userId);

    await direct.clientPortalLink.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const anonymous = await browser.newContext();
    try {
      const anon = await anonymous.newPage();
      anon.setDefaultNavigationTimeout(240_000);
      for (const token of [firstToken, expiring.token]) {
        const response = await anon.goto(`${BASE_URL}/portal/${token}`, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `dead link ${token} still answered`).toBe(404);
        const body = await anon.innerText("body");
        expect(body).not.toContain(ORG_NAME);
        expect(body).not.toContain(`C Diner ${suffix}`);
        const pdf = await anon.request.get(`${BASE_URL}/portal/${token}/pdf`, { timeout: 120_000 });
        expect(pdf.status()).toBe(404);
        expect((await pdf.body()).subarray(0, 5).toString()).not.toBe("%PDF-");
      }
    } finally {
      await anonymous.close();
    }
    // Dead links must not log views.
    expect(await direct.portalAccessLogEntry.count({ where: { linkId: expiring.id } })).toBe(0);

    await page.waitForTimeout(2_000);
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const text = await bodyTextWithDetailsOpen(page);
    expect(text).toContain("Revoked");
    expect(text).toContain("Expired");
    expect(text).toContain(`Revoked by ${EMAIL}`);
  }, 600_000);

  it("C5 · another firm's report is unreachable: by consultant URL, by evidence URL, and by a link row that names it", async () => {
    // C5 provokes 404s on purpose; mark where they start so the final sweep can filter them out
    // of this slice without discarding anything C1-C4 logged (the B11 pattern — truncating the
    // array here would wipe the earlier tests' evidence along with the noise).
    errorsBeforeC5 = pageErrors.significant().length;
    // Signed in as this firm, asking for the other firm's report and evidence by id.
    const pdf = await page.request.get(`${BASE_URL}/api/reports/${other.reportId}/pdf`, { timeout: 120_000 });
    expect(pdf.status()).toBe(404);
    expect((await pdf.body()).subarray(0, 5).toString()).not.toBe("%PDF-");
    const evidenceId = (await direct.evidence.create({
      data: { orgId: other.orgId, findingId: other.findingId, kind: "DOCUMENT", storageKey: `${other.orgId}/evidence/x/other.pdf`, text: "other.pdf" },
    })).id;
    const ev = await page.request.get(`${BASE_URL}/api/evidence/${evidenceId}`, { timeout: 120_000 });
    expect(ev.status()).toBe(404);
    const auditPage = await page.goto(`${BASE_URL}/engagements/${other.engagementId}/audits/${other.auditId}`, { waitUntil: "domcontentloaded" });
    expect(auditPage?.status()).toBe(404);
    expect(await page.innerText("body")).not.toContain("Diner");

    // A portal link row in THIS org that names the OTHER org's report: the two statements of
    // ownership disagree, and the portal must refuse rather than pick one.
    const mismatched = await direct.clientPortalLink.create({
      data: { orgId, reportId: other.reportId, token: `e2e-c-mismatch-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const anonymous = await browser.newContext();
    try {
      const anon = await anonymous.newPage();
      anon.setDefaultNavigationTimeout(240_000);
      const response = await anon.goto(`${BASE_URL}/portal/${mismatched.token}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(404);
      expect((await anon.request.get(`${BASE_URL}/portal/${mismatched.token}/pdf`, { timeout: 120_000 })).status()).toBe(404);
    } finally {
      await anonymous.close();
      await direct.clientPortalLink.delete({ where: { id: mismatched.id } });
    }
  }, 600_000);

  it("C6 · regenerating after the findings change produces a new report; the old link keeps serving the old one", async () => {
    expect(firstReportId, "C1 did not produce a report; nothing to regenerate against").toBeTruthy();
    // A live link on the first report, to prove it is pinned to that report and not to "latest".
    const live = await direct.clientPortalLink.create({
      data: { orgId, reportId: firstReportId, token: `e2e-c-live-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await direct.finding.updateMany({ where: { auditId, severity: "RED" }, data: { severity: "GREEN", status: "PASS" } });

    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    await submitAndSettleSlow(page, page.locator('form:has(input[name="includeAppendix"]) button[type="submit"]'));

    const reports = await direct.report.findMany({ where: { auditId }, orderBy: { generatedAt: "asc" } });
    expect(reports).toHaveLength(2);
    expect(reports[0].id).toBe(firstReportId);
    expect(reports[0].computedOverallSeverity).toBe("RED");
    expect(reports[1].computedOverallSeverity).toBe("GREEN");
    expect(reports[1].pdfStorageKey).not.toBe(reports[0].pdfStorageKey);
    expect(await objectExists(orgId, reports[1].pdfStorageKey!)).toBe(true);
    expect(await objectExists(orgId, reports[0].pdfStorageKey!), "regenerating must not delete the earlier report's PDF").toBe(true);
    expect(await direct.clientPortalLink.count({ where: { reportId: reports[1].id } })).toBe(0);

    const anonymous = await browser.newContext();
    try {
      const anon = await anonymous.newPage();
      anon.setDefaultNavigationTimeout(240_000);
      expect((await anon.goto(`${BASE_URL}/portal/${live.token}`, { waitUntil: "domcontentloaded" }))?.status()).toBe(200);
      const pdf = await anon.request.get(`${BASE_URL}/portal/${live.token}/pdf`, { timeout: 120_000 });
      expect(pdf.status()).toBe(200);
      const firstBytes = await (await page.request.get(`${BASE_URL}/api/reports/${firstReportId}/pdf`, { timeout: 120_000 })).body();
      expect((await pdf.body()).equals(firstBytes), "the old link must serve the report it was created for").toBe(true);
    } finally {
      await anonymous.close();
    }

    await page.waitForTimeout(2_000);
    await page.goto(`${BASE_URL}/engagements/${engagementId}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
    const text = await page.innerText("body");
    expect((text.match(/Download PDF/g) ?? []).length).toBe(2);
  }, 600_000);

  it("reports no console or page errors on the consultant's pages", () => {
    // React 19's dev-only performance tracks call performance.measure() with server-component
    // timings; under heavy load the computed start can precede the page's time origin and the
    // browser throws "cannot have a negative time stamp". It comes from next dev's instrumentation,
    // not from application code, and never occurs in a production build. Filtered here rather than
    // in the shared helper (not this driver's file); reported to the plan owner.
    const all = pageErrors.significant().filter((m) => !/cannot have a negative time stamp/.test(m));
    // C5 provokes 404s deliberately; everything logged before it must be clean as-is, and within
    // C5's slice only the 404 resource-load messages are expected.
    const beforeC5 = all.slice(0, errorsBeforeC5);
    expect(beforeC5, `console errors before C5:\n${beforeC5.join("\n")}`).toEqual([]);
    const fromC5 = all.slice(errorsBeforeC5).filter((m) => !/status of 404/.test(m));
    expect(fromC5, `console errors from C5 on:\n${fromC5.join("\n")}`).toEqual([]);
  });
});
