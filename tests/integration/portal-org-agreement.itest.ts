import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolvePortalAccess } from "@/app/portal/[token]/access";
import { createOrgFixture, destroyOrgFixture, directPrisma, type OrgFixture } from "./helpers/fixtures";

/**
 * A portal link and the report it points at must belong to the same firm.
 *
 * The portal is the one anonymous surface in the product, and `resolvePortalAccess` reads the link
 * by token and then the report by `link.reportId` — two rows whose agreement nothing checked. The
 * org it returned came from the LINK, while the document came from the REPORT, so a row where those
 * disagree serves one firm's diligence report resolved against another firm's identity: for any
 * report generated before brand snapshots existed, that means a seller's report wrapped in a
 * different consultancy's name and logo, handed to a buyer.
 *
 * Not reachable through the application: `createPortalLink` takes the org from the session and
 * cannot see another org's report under RLS, so it refuses before writing. That makes it latent
 * rather than absent — and latent is the wrong thing to leave in the path that hands a confidential
 * document to an outside party, which is why spec.md §8 asks for two independent layers rather than
 * one correct one. Demonstrated by building the row directly, the way a restore, a merge or a future
 * code path could.
 */
describe("a portal link may only serve its own firm's report", () => {
  let alpha: OrgFixture;
  let bravo: OrgFixture;

  beforeAll(async () => {
    alpha = await createOrgFixture("agree-a");
    bravo = await createOrgFixture("agree-b");
  });

  afterAll(async () => {
    if (alpha) await destroyOrgFixture(alpha.orgId);
    if (bravo) await destroyOrgFixture(bravo.orgId);
  });

  /** Deliberately via the superuser client: the application layer already refuses this. */
  async function linkWith(orgId: string, reportId: string): Promise<string> {
    const token = `agree-${randomUUID()}`;
    await directPrisma.clientPortalLink.create({
      data: { orgId, reportId, token, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    return token;
  }

  it("resolves a link whose org matches its report", async () => {
    // The control. Without it a guard that refused everything would look like a pass.
    const token = await linkWith(alpha.orgId, alpha.reportId);
    const access = await resolvePortalAccess(token, { log: false });
    expect(access).not.toBeNull();
    expect(access!.orgId).toBe(alpha.orgId);
    expect(access!.reportId).toBe(alpha.reportId);
  });

  it("refuses a link whose org disagrees with its report's org", async () => {
    const token = await linkWith(bravo.orgId, alpha.reportId);
    expect(await resolvePortalAccess(token, { log: false })).toBeNull();
  });

  it("refuses in both directions, not just one", async () => {
    const token = await linkWith(alpha.orgId, bravo.reportId);
    expect(await resolvePortalAccess(token, { log: false })).toBeNull();
  });

  it("refuses rather than picking whichever org it prefers", async () => {
    // The tempting alternative is to trust the report's org and carry on serving the document.
    // Two rows disagreeing about who owns a report is a corrupt row, and the only safe reading of a
    // corrupt row on an anonymous surface is that there is nothing here — the same choice the
    // storage containment guard makes when a key resolves outside its root.
    const token = await linkWith(bravo.orgId, alpha.reportId);
    const access = await resolvePortalAccess(token, { log: false });
    expect(access).toBeNull();
  });
});
