import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { storageRoot } from "@/lib/storage/objectStore";
import { launchBrowser, requireServer } from "./helpers/browser";
import { BASE_URL } from "./helpers/http";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

/**
 * A stored object may only be served to the tenant whose prefix it sits under.
 *
 * Every key this product generates begins with an orgId segment (`evidenceKey`, `reportPdfKey`,
 * `orgLogoKey`), and until this suite existed that prefix was a naming convention rather than
 * something enforced. Six routes read a key out of a database row and fetched it; row-level
 * security scoped the ROW, and nothing constrained the KEY on it. The storage containment guard
 * refuses a key resolving outside the storage root, and a key naming another tenant's prefix is
 * comfortably inside it.
 *
 * Demonstrated before it was fixed: an Alpha-owned Evidence row whose storageKey pointed into
 * Bravo's prefix returned 200 and the document's contents to a signed-in Alpha user. That is a
 * seller's confidential document served to a different consultancy — spec.md §8's core
 * reputational risk, stated in its own words.
 *
 * Not reachable through the application, because the key builders take the org from the session.
 * That is exactly the argument this project has now watched fail three times in one day, which is
 * why the check lives at the operation rather than in the code that happens to build the key.
 *
 * Driven over the wire against a running server rather than through imported handlers, for the same
 * reason the API isolation suite is: the claim is about what the deployed product serves.
 */

const SENTINEL = `BRAVO_CONFIDENTIAL_${randomUUID()}`;
const PASSWORD = "correct-horse-battery-staple-9";

let browser: Browser;
let alpha: OrgFixture;
let bravo: OrgFixture;
let alphaEmail: string;
let crossedEvidenceId: string;
let crossedReportId: string;
let bravoEvidenceKey: string;
let portalToken: string;

beforeAll(async () => {
  await requireServer();
  browser = await launchBrowser();
  alpha = await createOrgFixture("keyten-a");
  bravo = await createOrgFixture("keyten-b");

  // A real file under Bravo's prefix, holding something only Bravo should ever see.
  bravoEvidenceKey = `${bravo.orgId}/evidence/${bravo.findingId}/bravo-contract.txt`;
  await mkdir(join(storageRoot(), bravo.orgId, "evidence", bravo.findingId), { recursive: true });
  await writeFile(join(storageRoot(), bravoEvidenceKey), SENTINEL);

  // Alpha-owned rows pointing into Bravo's prefix. Written with the superuser client on purpose:
  // the application refuses to produce these, and the point is that the read path must not rely on
  // that being true forever.
  crossedEvidenceId = (
    await directPrisma.evidence.create({
      data: {
        orgId: alpha.orgId,
        findingId: alpha.findingId,
        kind: "DOCUMENT",
        text: "innocent-looking.txt",
        storageKey: bravoEvidenceKey,
      },
    })
  ).id;

  crossedReportId = (
    await directPrisma.report.create({
      data: {
        orgId: alpha.orgId,
        auditId: alpha.auditId,
        computedOverallSeverity: "GREEN",
        overallCoveredCount: 0,
        overallTotalCount: 0,
        pdfStorageKey: bravoEvidenceKey,
      },
    })
  ).id;

  // A portal link that is entirely well-formed — it belongs to the same org as its report, so the
  // link/report agreement guard is satisfied — pointing at a report whose PDF key is another firm's.
  // This is the same disclosure with a BUYER on the receiving end instead of a consultant, and the
  // buyer is anonymous: no session, no org, nothing that could be scoped after the fact.
  portalToken = `keyten-${randomUUID()}`;
  await directPrisma.clientPortalLink.create({
    data: {
      orgId: alpha.orgId,
      reportId: crossedReportId,
      token: portalToken,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  alphaEmail = `keyten-${randomUUID().slice(0, 8)}@itest.invalid`;
  await directPrisma.user.create({
    data: {
      orgId: alpha.orgId,
      email: alphaEmail,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "OWNER",
    },
  });
});

afterAll(async () => {
  await browser?.close();
  if (alpha) await destroyOrgFixture(alpha.orgId);
  if (bravo) await destroyOrgFixture(bravo.orgId);
});

/** A signed-in Alpha session, fetching over the wire the way the browser would. */
async function asAlpha(path: string) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', alphaEmail);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });

    const response = await page.request.get(`${BASE_URL}${path}`);
    return { status: response.status(), body: await response.text() };
  } finally {
    await context.close();
  }
}

describe("a stored object is served only to its own tenant", () => {
  it("refuses an evidence row whose key points into another firm's prefix", async () => {
    const { status, body } = await asAlpha(`/api/evidence/${crossedEvidenceId}`);
    expect(body).not.toContain(SENTINEL);
    expect(status).toBe(404);
  });

  it("refuses a report whose PDF key points into another firm's prefix", async () => {
    const { status, body } = await asAlpha(`/api/reports/${crossedReportId}/pdf`);
    expect(body).not.toContain(SENTINEL);
    expect(status).toBe(404);
  });

  it("refuses to hand a buyer a report whose PDF key is another firm's", async () => {
    // Anonymous — the portal takes no session at all, so there is no later opportunity to scope
    // this. The link and report agree about their org (that guard landed separately); what neither
    // of them constrains is the key stored on the report.
    const response = await fetch(`${BASE_URL}/portal/${portalToken}/pdf`);
    const body = Buffer.from(await response.arrayBuffer()).toString("utf8");
    expect(body).not.toContain(SENTINEL);
    expect(response.status).not.toBe(200);
  });

  it("still serves a row whose key sits under its own prefix", async () => {
    // The control. Without it, a guard that refused every read would pass the two cases above while
    // breaking the product, which is the failure mode of a security fix nobody exercised positively.
    const ownKey = `${alpha.orgId}/evidence/${alpha.findingId}/alpha-own.txt`;
    const ownContent = `ALPHA_OWN_${randomUUID()}`;
    await mkdir(join(storageRoot(), alpha.orgId, "evidence", alpha.findingId), { recursive: true });
    await writeFile(join(storageRoot(), ownKey), ownContent);
    const own = await directPrisma.evidence.create({
      data: {
        orgId: alpha.orgId,
        findingId: alpha.findingId,
        kind: "DOCUMENT",
        text: "alpha-own.txt",
        storageKey: ownKey,
      },
    });

    const { status, body } = await asAlpha(`/api/evidence/${own.id}`);
    expect(status).toBe(200);
    expect(body).toContain(ownContent);
  });
});
