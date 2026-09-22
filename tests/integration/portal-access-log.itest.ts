import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withOrgScope } from "@/lib/db/scoped";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

/**
 * The portal access trail — who opened a shared report, and when.
 *
 * `docs/roadmap.md` Phase 3 lists "audit logging / access history surfaced to consultants as a
 * feature (spec.md §8)" as a deliverable, and it was reported during this session's cross-session
 * review as impossible because the app role supposedly had no SELECT on portal_access_log. Checked
 * against the live database rather than the migration text, that is not so: closecheck_app holds
 * SELECT (migration 20260911160500) and the table carries a tenant_isolation policy
 * (20260911154700). So the capability exists today and only the UI is missing — no schema change,
 * no new grant.
 *
 * This file is the standing proof of that, and it is worth more than a comment saying so, because
 * portal_access_log's policy is the most intricate one in the schema. The table has no orgId column
 * of its own — a buyer opening a portal link is not an authenticated org session — so isolation is
 * enforced through a subquery against the parent ClientPortalLink's orgId. Every other tenant table
 * compares a column directly. A subquery-based policy is exactly the kind that can silently degrade
 * into "visible to everyone" under a schema change, and nothing else in the suite covers it.
 */
describe("portal access trail is readable by its own org and no one else", () => {
  let alpha: OrgFixture;
  let bravo: OrgFixture;
  let alphaLinkId: string;
  let bravoLinkId: string;

  async function seedLinkWithViews(org: OrgFixture, views: number): Promise<string> {
    const link = await directPrisma.clientPortalLink.create({
      data: {
        orgId: org.orgId,
        reportId: org.reportId,
        token: `itest-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    for (let i = 0; i < views; i++) {
      await directPrisma.portalAccessLogEntry.create({
        data: { linkId: link.id, ipHash: `hash-${i}` },
      });
    }
    return link.id;
  }

  beforeAll(async () => {
    alpha = await createOrgFixture("trail-a");
    bravo = await createOrgFixture("trail-b");
    alphaLinkId = await seedLinkWithViews(alpha, 3);
    bravoLinkId = await seedLinkWithViews(bravo, 2);
  });

  afterAll(async () => {
    if (alpha) await destroyOrgFixture(alpha.orgId);
    if (bravo) await destroyOrgFixture(bravo.orgId);
  });

  it("lets a consultant read the view history of their own link", async () => {
    const entries = await withOrgScope(alpha.orgId, (tx) =>
      tx.portalAccessLogEntry.findMany({ where: { linkId: alphaLinkId } }),
    );
    expect(entries).toHaveLength(3);
    expect(entries[0].viewedAt).toBeInstanceOf(Date);
  });

  it("shows nothing from another org's link, even asked for by id", async () => {
    const entries = await withOrgScope(alpha.orgId, (tx) =>
      tx.portalAccessLogEntry.findMany({ where: { linkId: bravoLinkId } }),
    );
    expect(entries).toHaveLength(0);
  });

  it("counts only its own rows on an unfiltered read", async () => {
    // The dangerous failure for a subquery policy is not a wrong row appearing in a filtered query
    // but the policy evaporating entirely, which only an unfiltered read reveals.
    const alphaAll = await withOrgScope(alpha.orgId, (tx) => tx.portalAccessLogEntry.findMany({}));
    const bravoAll = await withOrgScope(bravo.orgId, (tx) => tx.portalAccessLogEntry.findMany({}));

    const alphaIds = new Set(alphaAll.map((e) => e.id));
    for (const entry of bravoAll) {
      expect(alphaIds.has(entry.id), "bravo's access-log row was visible to alpha").toBe(false);
    }
    expect(alphaAll.every((e) => e.linkId === alphaLinkId)).toBe(true);
  });

  it("aggregates within the org's own scope, which is what the UI would show", async () => {
    const count = await withOrgScope(alpha.orgId, (tx) =>
      tx.portalAccessLogEntry.count({ where: { linkId: alphaLinkId } }),
    );
    expect(count).toBe(3);

    const lastViewed = await withOrgScope(alpha.orgId, (tx) =>
      tx.portalAccessLogEntry.findFirst({
        where: { linkId: alphaLinkId },
        orderBy: { viewedAt: "desc" },
      }),
    );
    expect(lastViewed).toBeTruthy();
  });

  it("cannot be tampered with across orgs", async () => {
    const deleted = await withOrgScope(alpha.orgId, (tx) =>
      tx.portalAccessLogEntry.deleteMany({ where: { linkId: bravoLinkId } }),
    );
    expect(deleted.count).toBe(0);

    const stillThere = await withOrgScope(bravo.orgId, (tx) =>
      tx.portalAccessLogEntry.count({ where: { linkId: bravoLinkId } }),
    );
    expect(stillThere).toBe(2);
  });
});
