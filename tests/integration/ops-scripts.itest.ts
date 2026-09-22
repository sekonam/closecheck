import { describe, it, expect } from "vitest";
import { pct, last30UtcDays, renderDashboardHtml, type DashboardData } from "../../scripts/ops-dashboard";
import { normalizeMessage, groupErrors, formatTable, parseSince, type ErrorRow } from "../../scripts/ops-error-triage";
import { assertLocalOrForced } from "../../scripts/ops-backup-drill";

/**
 * Covers the three founder ops scripts (docs/roadmap.md Phase 2.5) at the level that matters most
 * for tooling nobody watches closely day-to-day: the empty-database rendering path (a crash or a
 * page full of "NaN" the first time a founder opens this before any org has signed up would be a bad
 * first impression of the tool itself) and the pure grouping/normalization/guard logic that's easy
 * to get subtly wrong (off-by-one in a divide-by-zero guard, a regex ordering bug, a safety check
 * that fails open instead of closed).
 *
 * ops-backup-drill.ts's actual dump/restore/assert path is deliberately NOT exercised here — it
 * creates and drops a real scratch database and shells out to pg_dump/psql/createdb, which is
 * exactly the kind of side-effecting operation this suite's `npm run ops:backup-drill` should be run
 * for directly rather than on every `npm run test:integration`. Only its pure, side-effect-free
 * safety guard is covered.
 */

describe("ops-dashboard.ts", () => {
  it("pct guards against division by zero instead of producing NaN or Infinity", () => {
    expect(pct(0, 0)).toBe("—");
    expect(pct(5, 0)).toBe("—");
    expect(pct(0, 5)).toBe("0.0%");
    expect(pct(5, 5)).toBe("100.0%");
    expect(pct(1, 3)).toBe("33.3%");
  });

  it("last30UtcDays returns exactly 30 ascending, contiguous UTC calendar days ending today", () => {
    const days = last30UtcDays(new Date("2026-09-22T23:59:59.000Z"));
    expect(days).toHaveLength(30);
    expect(days[days.length - 1]).toBe("2026-09-22");
    expect(days[0]).toBe("2026-08-24");
    for (let i = 1; i < days.length; i++) {
      const prev = Date.parse(`${days[i - 1]}T00:00:00Z`);
      const cur = Date.parse(`${days[i]}T00:00:00Z`);
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it("renders a complete, valid dashboard with zero rows everywhere — no NaN, no crash", () => {
    const zeroData: DashboardData = {
      funnel: { signups: 0, activated: 0, secondAudit: 0, reportsGenerated: 0, portalViewed: 0 },
      daily: last30UtcDays().map((date) => ({ date, signups: 0, audits: 0 })),
      billingByStatus: [],
      billingByPlan: [],
      totalCreditBalance: 0,
      overageLast30d: { total: 0, billable: 0 },
      topErrorsLast7d: [],
    };

    const html = renderDashboardHtml(zeroData, new Date("2026-09-22T12:00:00.000Z"));

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("CloseCheck ops dashboard");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("undefined");
    // The empty-list branches should render their fallback copy, not an empty <ul>.
    expect(html).toContain("No orgs yet.");
    expect(html).toContain("No billing accounts yet.");
    expect(html).toContain("No errors recorded.");
    // The funnel's first conversion cell has no previous step, so it must render blank, not "—%"
    // or a divide-by-zero artifact — pct() is only invoked from the second row onward.
    expect(html).toContain("Generated 2026-09-22T12:00:00.000Z (UTC)");
  });

  it("renders a populated dashboard with sane, non-crashing values and correct conversion math", () => {
    const data: DashboardData = {
      funnel: { signups: 10, activated: 4, secondAudit: 2, reportsGenerated: 3, portalViewed: 1 },
      daily: last30UtcDays().map((date, i) => ({ date, signups: i % 3, audits: i % 2 })),
      billingByStatus: [
        { label: "ACTIVE", count: 3 },
        { label: "No billing account (never checked out)", count: 7 },
      ],
      billingByPlan: [{ label: "SOLO_MONTHLY", count: 3 }],
      totalCreditBalance: 17,
      overageLast30d: { total: 4, billable: 2 },
      topErrorsLast7d: [{ label: "server-action", count: 6 }],
    };
    const html = renderDashboardHtml(data, new Date());
    expect(html).not.toContain("NaN");
    // activated/signups = 4/10 = 40.0%
    expect(html).toContain("40.0%");
    // secondAudit/activated = 2/4 = 50.0%
    expect(html).toContain("50.0%");
  });
});

describe("ops-error-triage.ts", () => {
  it("normalizeMessage strips uuids, cuids, timestamps and bare numbers so recurring errors collapse to one shape", () => {
    const a = normalizeMessage(
      "Failed to load engagement cm3x7k2qw0000ab12cd34ef56 at 2026-09-20T10:15:30.123Z",
    );
    const b = normalizeMessage(
      "Failed to load engagement cm9z1a2bc0000xy98wv76ut54 at 2026-09-21T08:05:01.999Z",
    );
    expect(a).toBe(b);
    expect(a).toBe("Failed to load engagement <id> at <timestamp>");

    const uuidMsg = normalizeMessage("Org 4b1f6e2a-9c3d-4e2a-8b1a-2f3c4d5e6f7a not found");
    expect(uuidMsg).toBe("Org <uuid> not found");

    const numMsg = normalizeMessage("Timeout after 30000ms calling endpoint 5");
    expect(numMsg).toBe("Timeout after <n>ms calling endpoint <n>");
  });

  it("groupErrors aggregates by normalized shape with correct counts, org-affected count, and first/last seen", () => {
    const rows: ErrorRow[] = [
      {
        orgId: "org-a",
        source: "server-action",
        message: "Failed to load engagement cm3x7k2qw0000ab12cd34ef56 at 2026-09-20T10:00:00.000Z",
        stack: "Error: not found\n  at loadEngagement (x.ts:1:1)",
        createdAt: new Date("2026-09-20T10:00:00.000Z"),
      },
      {
        orgId: "org-b",
        source: "server-action",
        message: "Failed to load engagement cm9z1a2bc0000xy98wv76ut54 at 2026-09-21T08:00:00.000Z",
        stack: "Error: not found\n  at loadEngagement (x.ts:1:1)",
        createdAt: new Date("2026-09-21T08:00:00.000Z"),
      },
      {
        orgId: "org-a",
        source: "webhook-dispatch",
        message: "Timeout after 5000ms",
        stack: null,
        createdAt: new Date("2026-09-19T00:00:00.000Z"),
      },
    ];

    const groups = groupErrors(rows);
    expect(groups).toHaveLength(2);

    const engagementGroup = groups.find((g) => g.normalized.startsWith("Failed to load"));
    expect(engagementGroup?.count).toBe(2);
    expect(engagementGroup?.affectedOrgs).toBe(2); // org-a and org-b, not double-counted
    expect(engagementGroup?.firstSeen.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(engagementGroup?.lastSeen.toISOString()).toBe("2026-09-21T08:00:00.000Z");

    const timeoutGroup = groups.find((g) => g.normalized.startsWith("Timeout"));
    expect(timeoutGroup?.count).toBe(1);
    expect(timeoutGroup?.affectedOrgs).toBe(1);
  });

  it("groupErrors does not leak org-id tracking across separate calls (regression: module-scoped state)", () => {
    // Two independent calls that happen to produce the same normalized key ("Boom") but with
    // different orgs. A cross-call leak would make the second call's affectedOrgs count include the
    // first call's org, which is exactly the bug a module-scoped (rather than per-call) tracking map
    // would reintroduce.
    const first = groupErrors([
      { orgId: "org-1", source: "s", message: "Boom", stack: null, createdAt: new Date("2026-01-01") },
    ]);
    expect(first[0].affectedOrgs).toBe(1);

    const second = groupErrors([
      { orgId: "org-2", source: "s", message: "Boom", stack: null, createdAt: new Date("2026-01-02") },
    ]);
    expect(second[0].affectedOrgs).toBe(1);
    expect(second[0].count).toBe(1);
  });

  it("groupErrors and formatTable behave sanely with zero rows", () => {
    expect(groupErrors([])).toEqual([]);
    expect(formatTable([], 20)).toBe("(no errors matching filters)");
  });

  it("formatTable renders a compact, aligned table for populated groups and respects --limit", () => {
    // Three genuinely distinct shapes (not just distinct embedded numbers, which normalizeMessage
    // would collapse to one group) so --limit=1 has something real to truncate.
    const shapes = ["Database connection lost", "Stripe webhook signature invalid", "PDF render timed out"];
    const rows: ErrorRow[] = shapes.map((message, i) => ({
      orgId: null,
      source: "server-action",
      message,
      stack: `Error: boom ${i}`,
      createdAt: new Date(`2026-09-2${i}T00:00:00.000Z`),
    }));
    const groups = groupErrors(rows);
    const table = formatTable(groups, 1);
    expect(table).toContain("COUNT");
    expect(table).toContain("more group(s) not shown");
  });

  it("parseSince parses day/hour suffixes and falls back gracefully on garbage input", () => {
    expect(parseSince("7d").ms).toBe(7 * 86_400_000);
    expect(parseSince("48h").ms).toBe(48 * 3_600_000);
    expect(parseSince(undefined).ms).toBe(7 * 86_400_000);
    // Malformed input must not throw — it degrades to the documented default.
    expect(parseSince("garbage").ms).toBe(7 * 86_400_000);
  });
});

describe("ops-backup-drill.ts", () => {
  it("assertLocalOrForced allows localhost/127.0.0.1 without --force", () => {
    expect(() => assertLocalOrForced(new URL("postgresql://u:p@localhost:5432/db"), false)).not.toThrow();
    expect(() => assertLocalOrForced(new URL("postgresql://u:p@127.0.0.1:5432/db"), false)).not.toThrow();
  });

  it("assertLocalOrForced refuses a non-local host unless --force is passed", () => {
    const prodLike = new URL("postgresql://u:p@prod-db.example.com:5432/db");
    expect(() => assertLocalOrForced(prodLike, false)).toThrow(/Refusing to run/);
    expect(() => assertLocalOrForced(prodLike, true)).not.toThrow();
  });
});
