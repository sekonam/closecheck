import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { consumeCreditForBillableWork, getCreditBalance, grantPlanCreditsIfDue } from "@/lib/billing/credits";
import { createOrgFixture, destroyOrgFixture, type OrgFixture } from "./helpers/fixtures";

/**
 * WHEN a credit is consumed, against the real database and real RLS.
 *
 * spec.md §9 includes unlimited Tier A screening in the base subscription; a credit is the price
 * of a full audit, and full begins at the first Tier B/C entry. Until 2026-09-24 the credit was
 * consumed in createAudit, before any tier ran. These hold the corrected rule still: creation
 * consumes nothing; the first billable action consumes exactly once; every later billable action
 * on the same audit — and two racing to be first — consume nothing more.
 */
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

describe("an audit's credit is consumed by its first billable entry, once", () => {
  let org: OrgFixture;
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";
    process.env.BILLING_INCLUDED_AUDITS_MONTHLY = "3";
    org = await createOrgFixture("billable-work");
    await withOrgScope(org.orgId, (tx) => grantPlanCreditsIfDue(tx, org.orgId, "SOLO_MONTHLY"));
  });
  afterAll(async () => {
    await destroyOrgFixture(org.orgId);
    await direct.$disconnect();
  });

  async function ledgerRowsFor(auditId: string) {
    return direct.auditCreditEntry.findMany({ where: { auditId } });
  }

  it("an audit that exists has consumed nothing merely by existing", async () => {
    const audit = await direct.audit.findUniqueOrThrow({ where: { id: org.auditId } });
    expect(audit.creditConsumedAt).toBeNull();
    expect(await ledgerRowsFor(org.auditId)).toHaveLength(0);
    expect(await withOrgScope(org.orgId, (tx) => getCreditBalance(tx, org.orgId))).toBe(3);
  });

  it("the first billable action consumes one credit and stamps the audit", async () => {
    const result = await withOrgScope(org.orgId, (tx) => consumeCreditForBillableWork(tx, org.orgId, org.auditId));
    expect(result.outcome).toBe("consumed");
    const audit = await direct.audit.findUniqueOrThrow({ where: { id: org.auditId } });
    expect(audit.creditConsumedAt).toBeInstanceOf(Date);
    expect(await ledgerRowsFor(org.auditId)).toHaveLength(1);
    expect(await withOrgScope(org.orgId, (tx) => getCreditBalance(tx, org.orgId))).toBe(2);
  });

  it("every later billable action on the same audit consumes nothing more", async () => {
    for (let i = 0; i < 3; i++) {
      const again = await withOrgScope(org.orgId, (tx) => consumeCreditForBillableWork(tx, org.orgId, org.auditId));
      expect(again.outcome).toBe("already-consumed");
    }
    expect(await ledgerRowsFor(org.auditId)).toHaveLength(1);
    expect(await withOrgScope(org.orgId, (tx) => getCreditBalance(tx, org.orgId))).toBe(2);
  });

  it("two first actions racing consume exactly once between them", async () => {
    const audit = await direct.audit.create({
      data: { orgId: org.orgId, engagementId: org.engagementId, templateId: (await direct.audit.findUniqueOrThrow({ where: { id: org.auditId } })).templateId },
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        withOrgScope(org.orgId, (tx) => consumeCreditForBillableWork(tx, org.orgId, audit.id)),
      ),
    );
    expect(results.filter((r) => r.outcome === "consumed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already-consumed")).toHaveLength(3);
    expect(await ledgerRowsFor(audit.id)).toHaveLength(1);
  });

  it("another org cannot consume this org's audit — it does not resolve under RLS", async () => {
    const other = await createOrgFixture("billable-work-other");
    try {
      await expect(
        withOrgScope(other.orgId, (tx) => consumeCreditForBillableWork(tx, other.orgId, org.auditId)),
      ).rejects.toThrow(/Audit not found/);
    } finally {
      await destroyOrgFixture(other.orgId);
    }
  });
});
