import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

import { withOrgScope } from "@/lib/db/scoped";
import { revokePortalLink } from "@/lib/portal/revoke";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

/**
 * Who pulled a shared report back, and when it happened.
 *
 * `docs/spec.md` §12 carries an open question on whether a Member may revoke a Client Portal Link
 * they did not create, and defers it — correctly — until a firm hits it on a live engagement. But
 * the same entry asserts "the action is attributable now (§8)", and that was only true of creation:
 * `createdById` named the seat that sent a report outside the firm, while revocation wrote a bare
 * `revokedAt`. The harm the open question describes is a colleague's delivery being destroyed
 * "possibly without their knowing" — which a firm looking at "Revoked · <timestamp>" cannot report
 * back, so the evidence the decision waits on could never arrive. These cases hold the attribution
 * that makes the deferral's own exit condition reachable. They do not decide who may act.
 *
 * Exercised against real rows through the RLS-scoped client, the way the action runs, rather than
 * unit-testing a predicate: a revoker in another org must fail because their row is invisible under
 * this org's scope, and that is a property of the transaction, not of the function.
 */
describe("portal link revocation is attributable", () => {
  let org: OrgFixture;
  let other: OrgFixture;
  let colleagueId: string;

  async function seedLink(): Promise<string> {
    const link = await directPrisma.clientPortalLink.create({
      data: {
        orgId: org.orgId,
        reportId: org.reportId,
        token: `itest-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        createdById: org.userId,
      },
    });
    return link.id;
  }

  const read = (linkId: string) =>
    directPrisma.clientPortalLink.findUniqueOrThrow({ where: { id: linkId } });

  beforeAll(async () => {
    org = await createOrgFixture("revoke-a");
    other = await createOrgFixture("revoke-b");
    colleagueId = (
      await directPrisma.user.create({
        data: {
          orgId: org.orgId,
          email: `colleague-${randomUUID()}@itest.invalid`,
          passwordHash: "itest-not-a-real-hash",
          name: "Colleague Two",
          role: "MEMBER",
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (org) await destroyOrgFixture(org.orgId);
    if (other) await destroyOrgFixture(other.orgId);
  });

  it("records which seat revoked the link, not only that it was revoked", async () => {
    const linkId = await seedLink();
    await withOrgScope(org.orgId, (tx) => revokePortalLink(tx, linkId, colleagueId));

    const link = await read(linkId);
    expect(link.revokedAt).not.toBeNull();
    expect(link.revokedById).toBe(colleagueId);
  });

  it("keeps the creator distinct from the revoker", async () => {
    // The whole point of the §12 question is the case where these differ. A schema that reused
    // createdById, or a display that showed the creator beside "Revoked", would report the wrong
    // person for the action the firm is trying to understand.
    const linkId = await seedLink();
    await withOrgScope(org.orgId, (tx) => revokePortalLink(tx, linkId, colleagueId));

    const link = await read(linkId);
    expect(link.createdById).toBe(org.userId);
    expect(link.revokedById).toBe(colleagueId);
    expect(link.revokedById).not.toBe(link.createdById);
  });

  it("is idempotent: the first revocation is the one recorded", async () => {
    // revokeApiKey guards on an existing revokedAt; this path did not, so a second click moved the
    // timestamp. Once the actor is recorded that is worse than untidy — the trail would name
    // whoever clicked a revoked link's button last, and date the withdrawal to that moment, in the
    // one record a firm would consult to find out what happened to a client's report.
    const linkId = await seedLink();
    await withOrgScope(org.orgId, (tx) => revokePortalLink(tx, linkId, org.userId));
    const first = await read(linkId);

    await new Promise((r) => setTimeout(r, 25));
    await withOrgScope(org.orgId, (tx) => revokePortalLink(tx, linkId, colleagueId));
    const second = await read(linkId);

    expect(second.revokedAt?.toISOString()).toBe(first.revokedAt?.toISOString());
    expect(second.revokedById).toBe(org.userId);
  });

  it("refuses a link belonging to another firm", async () => {
    // Under RLS the row resolves to zero rows rather than to a Postgres error, so this must surface
    // as "not found" rather than crashing — and must not revoke anything.
    const foreign = await directPrisma.clientPortalLink.create({
      data: {
        orgId: other.orgId,
        reportId: other.reportId,
        token: `itest-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    await expect(
      withOrgScope(org.orgId, (tx) => revokePortalLink(tx, foreign.id, org.userId)),
    ).rejects.toThrow("Link not found.");

    expect((await read(foreign.id)).revokedAt).toBeNull();
  });
});
