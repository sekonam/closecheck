/**
 * Founder-only error triage CLI (docs/roadmap.md Phase 2.5, spec.md §11's error-tracking half).
 * error_events rows carry a raw message per occurrence, so the same underlying bug (a failed lookup
 * for org X today, org Y tomorrow) shows up as N distinct-looking rows unless something groups them
 * by shape rather than by exact text. This script does that grouping and prints it as a table —
 * nothing more: no route, no dashboard write, no mutation of error_events (read-only), matching the
 * same offline-CLI-only posture as scripts/ops-dashboard.ts.
 *
 * Connects as DIRECT_DATABASE_URL for the same reason scripts/metrics-report.ts does: error_events
 * is INSERT-only for the app role (prisma/migrations/20260922090000), so reading it back at all
 * requires the superuser/migration role, not a new grant on the app role.
 *
 * Run with: npm run ops:errors -- [--since=7d] [--source=<name>] [--limit=20]
 */
import { PrismaClient } from "@prisma/client";

const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export type Options = { sinceMs: number; sinceLabel: string; source?: string; limit: number };

const DEFAULT_SINCE = "7d";
const DEFAULT_LIMIT = 20;
// Hard cap on rows pulled into memory for grouping — this is a triage tool for a young product's
// error volume, not a log aggregator; a pathological spike (e.g. a retry storm) should make the
// script warn and show a partial picture rather than try to load an unbounded result set.
const MAX_ROWS_FETCHED = 20_000;

/** Parses `<N>d` or `<N>h` (e.g. "7d", "48h"). Falls back to the 7-day default on anything else,
 * with a warning — a malformed flag should degrade gracefully, not crash a founder's terminal. */
export function parseSince(arg: string | undefined): { ms: number; label: string } {
  const raw = arg ?? DEFAULT_SINCE;
  const match = /^(\d+)(d|h)$/.exec(raw.trim());
  if (!match) {
    console.error(`Could not parse --since=${JSON.stringify(raw)}; expected e.g. "7d" or "48h". Using ${DEFAULT_SINCE}.`);
    return parseSince(DEFAULT_SINCE);
  }
  const [, nStr, unit] = match;
  const n = Number(nStr);
  const unitMs = unit === "d" ? 86_400_000 : 3_600_000;
  return { ms: n * unitMs, label: raw };
}

export function parseArgs(argv: string[]): Options {
  let since: string | undefined;
  let source: string | undefined;
  let limit = DEFAULT_LIMIT;
  for (const arg of argv) {
    if (arg.startsWith("--since=")) since = arg.slice("--since=".length);
    else if (arg.startsWith("--source=")) source = arg.slice("--source=".length);
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  const { ms, label } = parseSince(since);
  return { sinceMs: ms, sinceLabel: label, source, limit };
}

// ---------------------------------------------------------------------------
// Normalization — the actual grouping logic, kept pure and exported so it can be unit-tested
// against fixed strings without a database (tests/integration/ops-error-triage.itest.ts).
// ---------------------------------------------------------------------------

// Order matters: an ISO timestamp is a run of digits too, so it must be matched and replaced before
// the generic digit-run pattern would otherwise chew it up piecemeal (e.g. leaving a lone "20" and
// "26" instead of the whole timestamp collapsing to one token). Same reasoning puts UUID/cuid before
// the generic digit-run pattern — their hex segments are numeric-looking but must group as one id.
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Prisma's default cuid(): lowercase 'c' followed by 24 base36 characters, 25 chars total.
const CUID = /\bc[a-z0-9]{24}\b/g;
const NUMBER_RUN = /\d+/g;

/**
 * Collapses a raw error message to a shape that recurring occurrences of the same underlying bug
 * share, even when each occurrence embeds a different id/timestamp/count. This is intentionally
 * aggressive — e.g. it collapses "retry 3 of 5" and "retry 1 of 2" to the same shape — because the
 * cost of over-grouping (two genuinely different messages sharing a row, distinguishable via the
 * example stack) is lower than the cost of under-grouping (the same bug scattered across dozens of
 * one-count rows that never surface as a pattern).
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(ISO_TIMESTAMP, "<timestamp>")
    .replace(UUID, "<uuid>")
    .replace(CUID, "<id>")
    .replace(NUMBER_RUN, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type ErrorRow = {
  orgId: string | null;
  source: string;
  message: string;
  stack: string | null;
  createdAt: Date;
};

export type ErrorGroup = {
  normalized: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  affectedOrgs: number;
  sources: string[];
  exampleStack: string | null;
  exampleMessage: string;
};

export function groupErrors(rows: ErrorRow[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  // Per-call, not module-scoped: affected-org tracking needs a Set per group, but a Set doesn't
  // belong on the exported ErrorGroup value (it would need special-casing in every test/consumer
  // equality check). Scoping this map to the function call — rather than hoisting it to module
  // scope — also avoids a real cross-call leak: a module-scoped map keyed by normalized message
  // would carry org ids over from a previous groupErrors() call whenever two calls happened to
  // produce the same normalized key (exactly the shape of calling this repeatedly in a test file).
  const orgSets = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = normalizeMessage(row.message);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        normalized: key,
        count: 1,
        firstSeen: row.createdAt,
        lastSeen: row.createdAt,
        affectedOrgs: row.orgId ? 1 : 0,
        sources: [row.source],
        // The most recent occurrence's stack is the most likely to still be relevant to the current
        // deployed code — an old stack pointing at a since-refactored line is worse than none.
        exampleStack: row.stack,
        exampleMessage: row.message,
      });
      orgSets.set(key, new Set(row.orgId ? [row.orgId] : []));
      continue;
    }
    existing.count += 1;
    if (row.createdAt < existing.firstSeen) existing.firstSeen = row.createdAt;
    if (row.createdAt >= existing.lastSeen) {
      existing.lastSeen = row.createdAt;
      existing.exampleStack = row.stack;
      existing.exampleMessage = row.message;
    }
    if (!existing.sources.includes(row.source)) existing.sources.push(row.source);
    const set = orgSets.get(key)!;
    if (row.orgId) set.add(row.orgId);
    existing.affectedOrgs = set.size;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function formatTable(groups: ErrorGroup[], limit: number): string {
  if (groups.length === 0) return "(no errors matching filters)";

  const shown = groups.slice(0, limit);
  const header = ["COUNT", "ORGS", "FIRST SEEN (UTC)", "LAST SEEN (UTC)", "SOURCE", "MESSAGE"];
  const rows = shown.map((g) => [
    String(g.count),
    String(g.affectedOrgs),
    g.firstSeen.toISOString(),
    g.lastSeen.toISOString(),
    truncate(g.sources.join(","), 20),
    truncate(g.normalized, 70),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");

  const lines = [line(header), line(widths.map((w) => "-".repeat(w)))];
  for (const r of rows) lines.push(line(r));

  if (groups.length > shown.length) {
    lines.push(`\n(${groups.length - shown.length} more group(s) not shown — raise --limit to see them)`);
  }

  // Example stacks are printed separately from the table body: a full stack trace does not fit in a
  // table column, and interleaving multi-line stacks between table rows would break the column
  // alignment every other tool in this codebase relies on being scannable.
  const examples = shown
    .map((g, i) => {
      const stackFirstLine = g.exampleStack?.split("\n")[0] ?? "(no stack recorded)";
      return `  [${i + 1}] ${truncate(g.exampleMessage, 160)}\n      ${stackFirstLine}`;
    })
    .join("\n");

  return `${lines.join("\n")}\n\nExamples (most recent occurrence per group):\n${examples}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - opts.sinceMs);

  const rows = await directPrisma.errorEvent.findMany({
    where: {
      createdAt: { gte: since },
      ...(opts.source ? { source: opts.source } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS_FETCHED,
    select: { orgId: true, source: true, message: true, stack: true, createdAt: true },
  });

  if (rows.length === MAX_ROWS_FETCHED) {
    console.error(
      `Warning: hit the ${MAX_ROWS_FETCHED}-row fetch cap — grouping below is over a partial window, not the full --since=${opts.sinceLabel} range.`,
    );
  }

  const groups = groupErrors(rows);

  console.log(
    `\nError triage — since ${opts.sinceLabel} ago${opts.source ? `, source=${opts.source}` : ""} (${rows.length} row(s), ${groups.length} group(s))`,
  );
  console.log("=".repeat(60));
  console.log(formatTable(groups, opts.limit));
  console.log();
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => directPrisma.$disconnect());
}
