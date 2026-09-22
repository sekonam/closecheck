import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withOrgScope } from "@/lib/db/scoped";
import { createOrgFixture, destroyOrgFixture, type OrgFixture } from "./helpers/fixtures";
import { apiGet, serverIsReachable, BASE_URL } from "./helpers/http";

/**
 * docs/releases.md §5 launch gate, Phase 4 depth set:
 *
 *   "API keys verified org-scoped at the RLS layer, not just application code — an API request with
 *    a valid key for org A provably cannot read org B's rows (spec.md §8, §13.2), demonstrated by an
 *    actual cross-org request test, not code inspection alone."
 *
 * This file is that test. Two points about *why* it is shaped this way:
 *
 * 1. The route handlers query by primary key with no `orgId` in the where clause (see
 *    src/app/api/v1/engagements/[id]/route.ts). That is intentional — it means a 404 for a foreign
 *    id can only be produced by the row-level security policy, because there is no application-level
 *    filter that could have produced it. So the HTTP assertions below are genuinely RLS assertions,
 *    which is what the gate asks for.
 * 2. The direct-DB block at the end removes the server from the picture entirely and proves the same
 *    thing one layer lower, so a future refactor that accidentally reintroduces an application-level
 *    filter cannot make this suite pass for the wrong reason.
 */
describe("Phase 4 launch gate — read-only API is org-scoped at the RLS layer", () => {
  let alpha: OrgFixture;
  let bravo: OrgFixture;
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await serverIsReachable();
    alpha = await createOrgFixture("alpha");
    bravo = await createOrgFixture("bravo");
  });

  afterAll(async () => {
    if (alpha) await destroyOrgFixture(alpha.orgId);
    if (bravo) await destroyOrgFixture(bravo.orgId);
  });

  /**
   * A skipped isolation test is indistinguishable from a passing one in CI output, and this suite is
   * a launch gate — so an unreachable server fails loudly instead of skipping quietly.
   */
  it("has a reachable app server to test against", () => {
    expect(
      serverUp,
      `No app server answering at ${BASE_URL}. Start one (\`npm run dev\`) or set CLOSECHECK_TEST_BASE_URL. ` +
        `This gate cannot be satisfied by code inspection, so the suite refuses to skip.`,
    ).toBe(true);
  });

  describe("over HTTP, with a real API key", () => {
    it("reads its own engagement", async () => {
      const res = await apiGet(`/api/v1/engagements/${alpha.engagementId}`, alpha.apiToken);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.engagement.id).toBe(alpha.engagementId);
    });

    it("returns 404 — not 200, not 500 — for another org's engagement id", async () => {
      const res = await apiGet(`/api/v1/engagements/${bravo.engagementId}`, alpha.apiToken);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain(bravo.orgName);
    });

    it("returns 404 for another org's audit id", async () => {
      const res = await apiGet(`/api/v1/audits/${bravo.auditId}`, alpha.apiToken);
      expect(res.status).toBe(404);
    });

    it("returns 404 for another org's report id", async () => {
      const res = await apiGet(`/api/v1/reports/${bravo.reportId}`, alpha.apiToken);
      expect(res.status).toBe(404);
    });

    it("lists only its own engagements", async () => {
      const res = await apiGet("/api/v1/engagements", alpha.apiToken);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids: string[] = body.engagements.map((e: { id: string }) => e.id);
      expect(ids).toContain(alpha.engagementId);
      expect(ids).not.toContain(bravo.engagementId);
    });

    it("works symmetrically — bravo's key cannot read alpha", async () => {
      const res = await apiGet(`/api/v1/engagements/${alpha.engagementId}`, bravo.apiToken);
      expect(res.status).toBe(404);
    });
  });

  describe("authentication failures are indistinguishable from each other", () => {
    it("rejects a missing key with 401", async () => {
      expect((await apiGet("/api/v1/engagements")).status).toBe(401);
    });

    it("rejects a revoked key with 401", async () => {
      expect((await apiGet("/api/v1/engagements", alpha.revokedApiToken)).status).toBe(401);
    });

    it("rejects an unknown but well-formed key with 401", async () => {
      const res = await apiGet("/api/v1/engagements", "cc_live_" + "A".repeat(43));
      expect(res.status).toBe(401);
    });

    it("rejects a malformed key with 401", async () => {
      expect((await apiGet("/api/v1/engagements", "not-a-token")).status).toBe(401);
    });

    it("gives byte-identical bodies for unknown, revoked and missing keys", async () => {
      const [missing, revoked, unknown] = await Promise.all([
        apiGet("/api/v1/engagements").then((r) => r.text()),
        apiGet("/api/v1/engagements", alpha.revokedApiToken).then((r) => r.text()),
        apiGet("/api/v1/engagements", "cc_live_" + "B".repeat(43)).then((r) => r.text()),
      ]);
      expect(revoked).toBe(missing);
      expect(unknown).toBe(missing);
    });
  });

  /**
   * The same isolation proven one layer below the HTTP API: no route handler, no application code
   * path at all — just the scoped connection the API uses, asked directly for a foreign row.
   */
  describe("at the database layer, with no application filtering involved", () => {
    it("returns null when alpha's scope queries bravo's engagement by primary key", async () => {
      const row = await withOrgScope(alpha.orgId, (tx) =>
        tx.engagement.findUnique({ where: { id: bravo.engagementId } }),
      );
      expect(row).toBeNull();
    });

    it("returns null when alpha's scope queries bravo's finding by primary key", async () => {
      const row = await withOrgScope(alpha.orgId, (tx) =>
        tx.finding.findUnique({ where: { id: bravo.findingId } }),
      );
      expect(row).toBeNull();
    });

    it("cannot count bravo's rows from alpha's scope", async () => {
      const count = await withOrgScope(alpha.orgId, (tx) =>
        tx.engagement.count({ where: { id: bravo.engagementId } }),
      );
      expect(count).toBe(0);
    });

    it("cannot update bravo's engagement from alpha's scope", async () => {
      const result = await withOrgScope(alpha.orgId, (tx) =>
        tx.engagement.updateMany({
          where: { id: bravo.engagementId },
          data: { businessName: "TAMPERED" },
        }),
      );
      expect(result.count).toBe(0);

      // And prove it from outside the scope, not just from the return value.
      const after = await withOrgScope(bravo.orgId, (tx) =>
        tx.engagement.findUnique({ where: { id: bravo.engagementId } }),
      );
      expect(after?.businessName).not.toBe("TAMPERED");
    });

    it("cannot delete bravo's engagement from alpha's scope", async () => {
      const result = await withOrgScope(alpha.orgId, (tx) =>
        tx.engagement.deleteMany({ where: { id: bravo.engagementId } }),
      );
      expect(result.count).toBe(0);
    });
  });
});
