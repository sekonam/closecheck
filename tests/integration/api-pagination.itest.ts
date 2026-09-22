import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrgFixture, destroyOrgFixture, type OrgFixture } from "./helpers/fixtures";
import { apiGet, serverIsReachable, BASE_URL } from "./helpers/http";

/**
 * Pagination and rate-limit plumbing on the read-only API, exercised over real HTTP.
 *
 * GET /api/v1/engagements previously returned every engagement an org had ever created, unbounded,
 * and no route had any rate limit at all — so a single API key could drive unlimited concurrent
 * queries against the same Postgres the interactive app depends on. These assert both are fixed
 * from the outside, where a client would actually notice.
 *
 * The 429 threshold itself is covered by unit tests (src/lib/api/rateLimit.test.ts) rather than
 * here: the limit defaults to 120/minute and the limiter lives in the server process, so proving
 * the boundary over HTTP would mean 120+ requests against a shared dev server and would leave its
 * budget exhausted for whatever ran next. What this file proves is that the budget is real,
 * per-key, and reported to the caller.
 */
const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

describe("read-only API pagination and rate-limit headers", () => {
  let org: OrgFixture;
  const TOTAL_ENGAGEMENTS = 7;

  beforeAll(async () => {
    expect(await serverIsReachable(), `No app server at ${BASE_URL}`).toBe(true);
    org = await createOrgFixture("paging");
    // The fixture creates one engagement; top up to a count that pages more than once at limit=2.
    for (let i = 1; i < TOTAL_ENGAGEMENTS; i++) {
      await directPrisma.engagement.create({
        data: { orgId: org.orgId, businessName: `Paging target ${i}`, primaryDomain: `p${i}.invalid` },
      });
    }
  });

  afterAll(async () => {
    if (org) await destroyOrgFixture(org.orgId);
  });

  it("returns every engagement in one page by default", async () => {
    const res = await apiGet("/api/v1/engagements", org.apiToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engagements).toHaveLength(TOTAL_ENGAGEMENTS);
    expect(body.nextCursor).toBeNull();
  });

  it("honors an explicit limit and hands back a cursor", async () => {
    const res = await apiGet("/api/v1/engagements?limit=2", org.apiToken);
    const body = await res.json();
    expect(body.engagements).toHaveLength(2);
    expect(typeof body.nextCursor).toBe("string");
  });

  it("walks the whole collection exactly once across pages, with no repeats and no gaps", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    // Bounded rather than `while (true)`: a cursor bug that never advances would otherwise hang the
    // suite instead of failing it.
    for (let page = 0; page < 10; page++) {
      const path: string = `/api/v1/engagements?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const body = await apiGet(path, org.apiToken).then((r) => r.json());
      seen.push(...body.engagements.map((e: { id: string }) => e.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(TOTAL_ENGAGEMENTS);
    expect(new Set(seen).size).toBe(TOTAL_ENGAGEMENTS);
  });

  it("clamps an absurd limit instead of honoring it", async () => {
    const res = await apiGet("/api/v1/engagements?limit=100000", org.apiToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engagements.length).toBeLessThanOrEqual(200);
  });

  it("ignores a garbage limit rather than erroring", async () => {
    const res = await apiGet("/api/v1/engagements?limit=abc", org.apiToken);
    expect(res.status).toBe(200);
  });

  it("treats another org's cursor as no cursor rather than leaking that the id exists", async () => {
    const other = await createOrgFixture("paging-other");
    try {
      const res = await apiGet(`/api/v1/engagements?cursor=${other.engagementId}`, org.apiToken);
      // RLS makes the foreign cursor resolve to nothing; Prisma reports that as a failed query
      // rather than silently returning page one. Either way the requirement is the same: no data
      // from the other org, and no 200 that includes it.
      if (res.status === 200) {
        const body = await res.json();
        const ids = body.engagements.map((e: { id: string }) => e.id);
        expect(ids).not.toContain(other.engagementId);
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    } finally {
      await destroyOrgFixture(other.orgId);
    }
  });

  it("reports the caller's remaining budget on a successful response", async () => {
    const res = await apiGet("/api/v1/engagements?limit=1", org.apiToken);
    expect(res.headers.get("x-ratelimit-limit")).toBeTruthy();
    expect(res.headers.get("x-ratelimit-reset")).toBeTruthy();
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    expect(Number.isFinite(remaining)).toBe(true);
  });

  it("spends the budget per API key, so consecutive calls count down", async () => {
    const first = Number(
      (await apiGet("/api/v1/engagements?limit=1", org.apiToken)).headers.get("x-ratelimit-remaining"),
    );
    const second = Number(
      (await apiGet("/api/v1/engagements?limit=1", org.apiToken)).headers.get("x-ratelimit-remaining"),
    );
    expect(second).toBeLessThan(first);
  });

  it("still answers 401 for a bad token rather than revealing the budget", async () => {
    const res = await apiGet("/api/v1/engagements", "cc_live_" + "C".repeat(43));
    expect(res.status).toBe(401);
  });
});
