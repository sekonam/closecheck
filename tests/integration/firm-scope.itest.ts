import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireOwner } from "@/lib/auth/requireOwner";
import { withOrgScope } from "@/lib/db/scoped";

/**
 * Which actions belong to the FIRM rather than to an engagement.
 *
 * A probe found the settings page telling users "Only the account owner can invite or remove
 * teammates" while any member could change the firm's name, colour and logo on every report it had
 * ever issued — the product asserting a role model in copy that no data path read. These cases
 * hold the line that closed that, and the reasoning for where the line sits is in
 * src/lib/auth/requireOwner.ts.
 *
 * Deliberately exercises the guard against real rows through the real scoped client rather than
 * unit-testing a predicate: the role has to be read inside the caller's own RLS-scoped transaction,
 * and reading it from the session token instead — which is issued once and would not notice a
 * demotion — is the mistake this is here to catch.
 */

const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `Firm Scope ${suffix}`;

let orgId: string;
let ownerId: string;
let memberId: string;
let otherOrgId: string;
let otherOwnerId: string;

beforeAll(async () => {
  const org = await directPrisma.consultantOrg.create({ data: { name: ORG_NAME } });
  orgId = org.id;
  ownerId = (
    await directPrisma.user.create({
      data: { orgId, email: `owner-${suffix}@itest.invalid`, passwordHash: "x", role: "OWNER" },
    })
  ).id;
  memberId = (
    await directPrisma.user.create({
      data: { orgId, email: `member-${suffix}@itest.invalid`, passwordHash: "x", role: "MEMBER" },
    })
  ).id;

  const other = await directPrisma.consultantOrg.create({ data: { name: `${ORG_NAME} other` } });
  otherOrgId = other.id;
  otherOwnerId = (
    await directPrisma.user.create({
      data: { orgId: otherOrgId, email: `other-${suffix}@itest.invalid`, passwordHash: "x", role: "OWNER" },
    })
  ).id;
});

afterAll(async () => {
  await directPrisma.consultantOrg
    .deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })
    .catch(() => {});
  await directPrisma.$disconnect();
});

/** Runs the guard the way an action does: inside that caller's own scoped transaction. */
async function attempt(callerOrgId: string, userId: string): Promise<string | null> {
  try {
    await withOrgScope(callerOrgId, (tx) => requireOwner(tx, userId, "change the firm's branding"));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("firm-scoped actions", () => {
  it("lets the account owner through", async () => {
    expect(await attempt(orgId, ownerId)).toBeNull();
  });

  it("refuses a member, naming what they cannot do", async () => {
    const message = await attempt(orgId, memberId);
    expect(message).toBe("Only the account owner can change the firm's branding.");
  });

  it("refuses an owner of a DIFFERENT firm", async () => {
    // Their own org's role is OWNER, so a guard that read the role without scoping — from a token,
    // or through an unscoped client — would let them through. Under RLS the user row simply is not
    // visible from this org's scope, so it fails as "account could not be found".
    const message = await attempt(orgId, otherOwnerId);
    expect(message).toBe("Your account could not be found.");
  });

  it("follows a demotion immediately, rather than trusting a stale claim", async () => {
    // The role is read per action inside the transaction. A session token is issued once and
    // cannot notice a demotion; a firm removing someone's authority would then wait for them to
    // sign out again.
    await directPrisma.user.update({ where: { id: ownerId }, data: { role: "MEMBER" } });
    expect(await attempt(orgId, ownerId)).toBe(
      "Only the account owner can change the firm's branding.",
    );

    await directPrisma.user.update({ where: { id: ownerId }, data: { role: "OWNER" } });
    expect(await attempt(orgId, ownerId)).toBeNull();
  });
});
