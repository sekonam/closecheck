import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withOrgScope } from "@/lib/db/scoped";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

/**
 * Tenant isolation and retention for `vendor_term_profiles` (added 2026-09-22).
 *
 * This table holds the highest-stakes rows in the schema. Everything else a firm owns is about the
 * firm's own work; this is the firm's recorded *reading of its clients' executed contracts* —
 * termination penalties, transferability, notice periods — carried across engagements. A leak here
 * shows one consultant another consultant's client's negotiated terms, which is the precise
 * reputational failure `docs/spec.md` §8 says this product cannot survive.
 *
 * It arrived with thorough unit tests for its normalisation and recall logic
 * (src/lib/audit/vendorMemory.test.ts) and with the isolation properties asserted in its commit
 * message — but no committed test exercised them, because those need a database and that suite has
 * none. A manual check is not a standing guarantee, and this is not a table to leave on one.
 *
 * Two of the cases below cover claims nothing else in the suite would catch:
 *
 * - **The write side.** Every other isolation test here proves a foreign row cannot be READ. This
 *   policy also has a WITH CHECK clause, and without it an org could write rows stamped with
 *   another org's id — poisoning that firm's recall with fabricated contract terms rather than
 *   reading theirs. Reads and writes are separately enforced and deserve separate assertions.
 * - **The retention tie.** These readings are derived from documents `spec.md` §8 requires be
 *   purgeable. If they outlived their engagement, the purge job would delete a seller's contract
 *   while a summary of its terms survived indefinitely — retention defeated by a cache. The
 *   cascade is what prevents that, so it is asserted rather than assumed from the schema.
 */
describe("vendor term profiles are isolated per org and die with their engagement", () => {
  let alpha: OrgFixture;
  let bravo: OrgFixture;

  async function seedReading(org: OrgFixture, vendor: string, penalty: string) {
    return directPrisma.vendorTermProfile.create({
      data: {
        orgId: org.orgId,
        engagementId: org.engagementId,
        itemTitle: "Point-of-sale contract terms",
        vendorKey: vendor.toLowerCase(),
        vendorLabel: vendor,
        values: { transferable: "No", penaltyAmount: penalty },
        sourceBusinessName: `Source for ${org.orgName}`,
      },
    });
  }

  beforeAll(async () => {
    alpha = await createOrgFixture("vendor-a");
    bravo = await createOrgFixture("vendor-b");
    await seedReading(alpha, "Toast", "12000");
    await seedReading(bravo, "Toast", "999999");
  });

  afterAll(async () => {
    if (alpha) await destroyOrgFixture(alpha.orgId);
    if (bravo) await destroyOrgFixture(bravo.orgId);
  });

  it("lets a firm read back its own reading of a vendor", async () => {
    const rows = await withOrgScope(alpha.orgId, (tx) => tx.vendorTermProfile.findMany({}));
    expect(rows).toHaveLength(1);
    expect((rows[0].values as { penaltyAmount: string }).penaltyAmount).toBe("12000");
  });

  it("shows nothing of another firm's on an unfiltered read of the same vendor", async () => {
    // Both orgs recorded a reading for the SAME vendor key, so a policy that had evaporated would
    // return two rows here rather than merely failing a filtered lookup.
    const rows = await withOrgScope(alpha.orgId, (tx) =>
      tx.vendorTermProfile.findMany({ where: { vendorKey: "toast" } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.orgId === alpha.orgId)).toBe(true);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain(bravo.orgName);
  });

  it("cannot reach another firm's reading by primary key", async () => {
    const bravoRow = await directPrisma.vendorTermProfile.findFirstOrThrow({
      where: { orgId: bravo.orgId },
    });
    const row = await withOrgScope(alpha.orgId, (tx) =>
      tx.vendorTermProfile.findUnique({ where: { id: bravoRow.id } }),
    );
    expect(row).toBeNull();
  });

  it("refuses a write stamped with another firm's org id", async () => {
    // The WITH CHECK side of the policy. Without it, one firm could plant fabricated contract terms
    // in another firm's recall — corrupting their diligence rather than merely reading it.
    await expect(
      withOrgScope(alpha.orgId, (tx) =>
        tx.vendorTermProfile.create({
          data: {
            orgId: bravo.orgId,
            engagementId: bravo.engagementId,
            itemTitle: "Point-of-sale contract terms",
            vendorKey: "planted",
            vendorLabel: "Planted",
            values: { penaltyAmount: "0" },
            sourceBusinessName: "injected",
          },
        }),
      ),
    ).rejects.toThrow();

    const planted = await directPrisma.vendorTermProfile.findFirst({ where: { vendorKey: "planted" } });
    expect(planted, "a cross-org row was actually written").toBeNull();
  });

  it("cannot modify or delete another firm's reading", async () => {
    const updated = await withOrgScope(alpha.orgId, (tx) =>
      tx.vendorTermProfile.updateMany({
        where: { orgId: bravo.orgId },
        data: { vendorLabel: "TAMPERED" },
      }),
    );
    expect(updated.count).toBe(0);

    const deleted = await withOrgScope(alpha.orgId, (tx) =>
      tx.vendorTermProfile.deleteMany({ where: { orgId: bravo.orgId } }),
    );
    expect(deleted.count).toBe(0);

    // Confirmed from outside the scope, not from the return values alone.
    const survivor = await directPrisma.vendorTermProfile.findFirstOrThrow({
      where: { orgId: bravo.orgId },
    });
    expect(survivor.vendorLabel).toBe("Toast");
  });

  it("dies with its engagement, so a reading cannot outlive the contract it came from", async () => {
    const doomed = await createOrgFixture("vendor-retention");
    try {
      await seedReading(doomed, "Toast", "4500");
      expect(
        await directPrisma.vendorTermProfile.count({ where: { orgId: doomed.orgId } }),
      ).toBe(1);

      await directPrisma.engagement.delete({ where: { id: doomed.engagementId } });

      // spec.md §8 requires uploaded documents to be purgeable. A summary of a contract's terms
      // surviving the engagement would defeat that — retention beaten by a cache.
      expect(
        await directPrisma.vendorTermProfile.count({ where: { orgId: doomed.orgId } }),
        "a vendor reading outlived the engagement it was derived from",
      ).toBe(0);
    } finally {
      await destroyOrgFixture(doomed.orgId);
    }
  });

  it("dies with its org", async () => {
    const doomed = await createOrgFixture("vendor-orgdelete");
    await seedReading(doomed, "Square", "7000");
    const orgId = doomed.orgId;
    await destroyOrgFixture(orgId);
    expect(await directPrisma.vendorTermProfile.count({ where: { orgId } })).toBe(0);
  });
});
