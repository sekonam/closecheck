/**
 * Founder-only static ops dashboard (docs/roadmap.md Phase 2.5, spec.md §11). Renders a single
 * self-contained HTML file to disk — no server, no route, no API endpoint. That is a deliberate
 * architectural constraint, not an oversight: founder cross-org visibility is a genuine "read across
 * every tenant" operation, and the one thing spec.md §8 says this product cannot afford is new
 * cross-org surface area reachable over HTTP. The safe shape for that kind of read is the same one
 * scripts/metrics-report.ts and scripts/purge-expired-documents.ts already use — an offline script
 * connecting as DIRECT_DATABASE_URL (the migration superuser role) — this script just renders that
 * data as a file instead of printing it to the terminal.
 *
 * Run with: npm run ops:dashboard [outputPath]
 * (outputPath defaults to ./.local-ops/dashboard.html)
 */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Same trust boundary as scripts/metrics-report.ts: metric_events/error_events are INSERT-only for
// the app role (prisma/migrations/20260922090000), so any read of them — and any cross-org read of
// tenant tables at all — has to go through the DIRECT role. Requires `-r dotenv/config` (see the
// npm script) to populate DIRECT_DATABASE_URL before this module-level client is constructed.
const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

// ---------------------------------------------------------------------------
// Data shape — kept separate from rendering so renderDashboardHtml can be unit-tested against a
// synthetic all-zero object without touching a database (see tests/integration/ops-dashboard.itest.ts).
// ---------------------------------------------------------------------------

export type FunnelCounts = {
  signups: number;
  activated: number; // orgs with >=1 audit (spec.md §11 "activation")
  secondAudit: number; // orgs with >=2 audits (spec.md §11 "retention proxy")
  reportsGenerated: number; // orgs with >=1 report
  portalViewed: number; // orgs with >=1 client-portal-link view
};

export type DailyCount = { date: string; signups: number; audits: number };

export type LabeledCount = { label: string; count: number };

export type DashboardData = {
  funnel: FunnelCounts;
  /** Exactly 30 entries, oldest first, UTC calendar days, zero-filled for days with no rows. */
  daily: DailyCount[];
  billingByStatus: LabeledCount[];
  billingByPlan: LabeledCount[];
  /** SUM(delta) across the entire ledger — every org's outstanding balance added together. */
  totalCreditBalance: number;
  overageLast30d: { total: number; billable: number };
  topErrorsLast7d: LabeledCount[];
};

// ---------------------------------------------------------------------------
// Pure helpers — no I/O, exported so tests can exercise them without a live database.
// ---------------------------------------------------------------------------

/**
 * Step-over-previous-step conversion, guarded against the empty-database case: with a zero
 * denominator there is no rate to report, and computing one anyway would render "NaN%" or a
 * misleading "0.0%" (which reads as "everyone drops off" rather than "no data yet"). An em dash is
 * the deliberate third state.
 */
export function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Ascending array of 30 `YYYY-MM-DD` strings in UTC, ending on `now`'s UTC calendar day. */
export function last30UtcDays(now: Date = new Date()): string[] {
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    days.push(new Date(startOfTodayUtc - i * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Data fetch — the only part of this file that touches Postgres.
// ---------------------------------------------------------------------------

export async function fetchDashboardData(): Promise<DashboardData> {
  const days = last30UtcDays();
  const rangeStart = new Date(`${days[0]}T00:00:00.000Z`);

  const [
    signups,
    activatedOrgs,
    secondAuditOrgs,
    reportOrgs,
    portalViewedOrgs,
    signupsByDayRows,
    auditsByDayRows,
    billingByStatusRows,
    billingByPlanRows,
    orgsWithBillingAccount,
    creditBalanceSum,
    overageRows,
    topErrorsRows,
  ] = await Promise.all([
    directPrisma.consultantOrg.count(),
    directPrisma
      .$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "orgId") AS n FROM audits`
      .then((r) => Number(r[0]?.n ?? 0)),
    directPrisma
      .$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (
          SELECT "orgId" FROM audits GROUP BY "orgId" HAVING COUNT(*) >= 2
        ) multi`
      .then((r) => Number(r[0]?.n ?? 0)),
    directPrisma
      .$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "orgId") AS n FROM reports`
      .then((r) => Number(r[0]?.n ?? 0)),
    // A portal view has no orgId of its own (portal_access_log rows are keyed by linkId, not org —
    // see prisma/migrations/20260911154700_row_level_security's comment on that table) so reaching
    // "which orgs" requires the join back through client_portal_links.
    directPrisma
      .$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT l."orgId") AS n
        FROM portal_access_log a
        JOIN client_portal_links l ON l.id = a."linkId"`
      .then((r) => Number(r[0]?.n ?? 0)),
    directPrisma.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM consultant_orgs
      WHERE "createdAt" >= ${rangeStart}
      GROUP BY 1`,
    directPrisma.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM audits
      WHERE "createdAt" >= ${rangeStart}
      GROUP BY 1`,
    directPrisma.$queryRaw<{ status: string; n: bigint }[]>`
      SELECT status::text AS status, COUNT(*) AS n FROM billing_accounts GROUP BY status`,
    directPrisma.$queryRaw<{ plan: string | null; n: bigint }[]>`
      SELECT plan::text AS plan, COUNT(*) AS n FROM billing_accounts GROUP BY plan`,
    directPrisma.billingAccount.count(),
    directPrisma.auditCreditEntry
      .aggregate({ _sum: { delta: true } })
      .then((r) => r._sum.delta ?? 0),
    directPrisma.$queryRaw<{ total: bigint; billable: bigint }[]>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE note LIKE 'billable%') AS billable
      FROM audit_credit_ledger
      WHERE reason = 'OVERAGE' AND "createdAt" >= now() - interval '30 days'`,
    directPrisma.$queryRaw<{ source: string; n: bigint }[]>`
      SELECT source, COUNT(*) AS n FROM error_events
      WHERE "createdAt" >= now() - interval '7 days'
      GROUP BY source ORDER BY n DESC LIMIT 10`,
  ]);

  const signupsByDay = new Map(signupsByDayRows.map((r) => [r.day, Number(r.n)]));
  const auditsByDay = new Map(auditsByDayRows.map((r) => [r.day, Number(r.n)]));
  const daily: DailyCount[] = days.map((date) => ({
    date,
    signups: signupsByDay.get(date) ?? 0,
    audits: auditsByDay.get(date) ?? 0,
  }));

  // Orgs that never checked out have no billing_accounts row at all, so they are invisible to a
  // GROUP BY on that table — surfaced here as an explicit bucket rather than silently missing from
  // the rollup (a founder scanning "billing state" needs the never-checked-out count as much as the
  // enum breakdown of orgs that did).
  const neverCheckedOut = signups - orgsWithBillingAccount;
  const billingByStatus: LabeledCount[] = billingByStatusRows.map((r) => ({
    label: r.status,
    count: Number(r.n),
  }));
  if (neverCheckedOut > 0) {
    billingByStatus.push({ label: "No billing account (never checked out)", count: neverCheckedOut });
  }
  const billingByPlan: LabeledCount[] = billingByPlanRows.map((r) => ({
    label: r.plan ?? "No plan selected",
    count: Number(r.n),
  }));

  const overageRow = overageRows[0];

  return {
    funnel: {
      signups,
      activated: activatedOrgs,
      secondAudit: secondAuditOrgs,
      reportsGenerated: reportOrgs,
      portalViewed: portalViewedOrgs,
    },
    daily,
    billingByStatus,
    billingByPlan,
    totalCreditBalance: creditBalanceSum,
    overageLast30d: {
      total: Number(overageRow?.total ?? 0),
      billable: Number(overageRow?.billable ?? 0),
    },
    topErrorsLast7d: topErrorsRows.map((r) => ({ label: r.source, count: Number(r.n) })),
  };
}

// ---------------------------------------------------------------------------
// Rendering — pure function of (data, generatedAt). No DOM, no network, no external stylesheet or
// script tag: the whole page has to open correctly from a local file:// URL with nothing else
// running, which rules out CDN fonts/icon sets and any client-side chart library.
// ---------------------------------------------------------------------------

const FUNNEL_STEPS: { key: keyof FunnelCounts; label: string }[] = [
  { key: "signups", label: "Signups" },
  { key: "activated", label: "Activated (≥1 audit)" },
  { key: "secondAudit", label: "Second audit" },
  { key: "reportsGenerated", label: "Report generated" },
  { key: "portalViewed", label: "Portal viewed" },
];

// Ordinal ramp for the funnel stages (dataviz skill: a single sequential hue, light→dark, for
// discrete ordered stages — never a rainbow, never categorical hues for what is one ordered
// measure). Kept no lighter than step 250 on the light surface so even the first bar clears 2:1
// contrast against the card background.
const FUNNEL_RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
// Two independent series (signups vs. audits) get distinct categorical hues, not two shades of one
// hue — shading would read as "the same thing, different intensity" when they're actually two
// different counts.
const SERIES_SIGNUPS = "#2a78d6"; // categorical slot 1 (blue)
const SERIES_AUDITS = "#eb6834"; // categorical slot 2 (orange)
// Status colors are reserved and never reused for a series — billing status is genuinely a status,
// not an identity, so it gets the fixed status palette instead of a categorical slot.
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#0ca30c",
  PAST_DUE: "#fab219",
  CANCELED: "#d03b3b",
  NONE: "#898781",
};

function renderFunnel(funnel: FunnelCounts): string {
  const counts = FUNNEL_STEPS.map((s) => funnel[s.key]);
  const max = Math.max(1, ...counts); // never divide by zero when every step is 0
  const rows = FUNNEL_STEPS.map((step, i) => {
    const count = funnel[step.key];
    const prevCount = i === 0 ? null : counts[i - 1];
    const widthPct = (count / max) * 100;
    const conversion = prevCount === null ? "" : `<span class="conv">${pct(count, prevCount)} of previous step</span>`;
    return `
      <div class="funnel-row">
        <div class="funnel-label">${escapeHtml(step.label)}</div>
        <div class="funnel-bar-track">
          <div class="funnel-bar" style="width:${widthPct}%;background:${FUNNEL_RAMP[i]}"></div>
        </div>
        <div class="funnel-count">${count}</div>
        <div class="funnel-conv">${conversion}</div>
      </div>`;
  }).join("");
  return `<div class="funnel">${rows}</div>`;
}

function renderDailyChart(daily: DailyCount[]): string {
  const maxVal = Math.max(1, ...daily.map((d) => Math.max(d.signups, d.audits)));
  const width = 620;
  const height = 130;
  const chartHeight = 100; // leaves room for axis labels below
  const barGroupWidth = width / daily.length;
  const barWidth = Math.max(2, barGroupWidth / 2 - 1);

  const bars = daily
    .map((d, i) => {
      const x0 = i * barGroupWidth;
      const signupH = (d.signups / maxVal) * chartHeight;
      const auditH = (d.audits / maxVal) * chartHeight;
      const title = escapeHtml(`${d.date}: ${d.signups} signup(s), ${d.audits} audit(s)`);
      // Native SVG <title> gives a hover tooltip with zero JavaScript, matching the "no JS
      // libraries" constraint while still exposing per-day values on hover.
      return `
        <g><title>${title}</title>
          <rect class="bar-signup" x="${x0}" y="${chartHeight - signupH}" width="${barWidth}" height="${Math.max(signupH, 0.5)}" />
          <rect class="bar-audit" x="${x0 + barWidth + 1}" y="${chartHeight - auditH}" width="${barWidth}" height="${Math.max(auditH, 0.5)}" />
        </g>`;
    })
    .join("");

  const firstLabel = daily[0]?.date.slice(5) ?? "";
  const lastLabel = daily[daily.length - 1]?.date.slice(5) ?? "";

  return `
    <svg class="daily-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Signups and audits per day, last 30 days">
      <line x1="0" y1="${chartHeight}" x2="${width}" y2="${chartHeight}" class="axis-line" />
      ${bars}
      <text x="0" y="${chartHeight + 16}" class="axis-label">${firstLabel}</text>
      <text x="${width}" y="${chartHeight + 16}" class="axis-label" text-anchor="end">${lastLabel}</text>
    </svg>
    <div class="legend">
      <span class="legend-item"><span class="swatch swatch-signup"></span>Signups</span>
      <span class="legend-item"><span class="swatch swatch-audit"></span>Audits created</span>
    </div>`;
}

function renderLabeledCounts(rows: LabeledCount[], emptyLabel: string, colorFor?: (label: string) => string): string {
  if (rows.length === 0) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return `<ul class="count-list">${rows
    .map((r) => {
      const color = colorFor?.(r.label);
      const dot = color ? `<span class="dot" style="background:${color}"></span>` : "";
      return `<li>${dot}<span class="cl-label">${escapeHtml(r.label)}</span><span class="cl-count">${r.count}</span><span class="cl-pct">${pct(r.count, total)}</span></li>`;
    })
    .join("")}</ul>`;
}

export function renderDashboardHtml(data: DashboardData, generatedAt: Date): string {
  const overagePctBillable = pct(data.overageLast30d.billable, data.overageLast30d.total);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CloseCheck ops dashboard</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --gridline: #e1e0d9;
    --border: rgba(11, 11, 11, 0.10);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --gridline: #2c2c2a;
      --border: rgba(255, 255, 255, 0.10);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 48px;
    background: var(--page);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .freshness { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); margin: 0 0 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }

  .funnel-row { display: grid; grid-template-columns: 140px 1fr 44px 170px; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
  .funnel-label { color: var(--text-secondary); }
  .funnel-bar-track { background: var(--gridline); border-radius: 4px; height: 14px; overflow: hidden; }
  .funnel-bar { height: 100%; border-radius: 4px; min-width: 2px; }
  .funnel-count { text-align: right; font-variant-numeric: tabular-nums; }
  .funnel-conv { color: var(--muted); }
  .conv { font-variant-numeric: tabular-nums; }

  .daily-chart { width: 100%; height: auto; overflow: visible; }
  .bar-signup { fill: ${SERIES_SIGNUPS}; }
  .bar-audit { fill: ${SERIES_AUDITS}; }
  .axis-line { stroke: var(--gridline); stroke-width: 1; }
  .axis-label { fill: var(--muted); font-size: 9px; }
  .legend { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: var(--text-secondary); }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .swatch-signup { background: ${SERIES_SIGNUPS}; }
  .swatch-audit { background: ${SERIES_AUDITS}; }

  .count-list { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .count-list li { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--gridline); }
  .count-list li:last-child { border-bottom: none; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .cl-label { flex: 1; color: var(--text-secondary); }
  .cl-count { font-variant-numeric: tabular-nums; }
  .cl-pct { font-variant-numeric: tabular-nums; color: var(--muted); width: 52px; text-align: right; }
  .empty { color: var(--muted); font-size: 13px; margin: 0; }

  .stat-row { display: flex; gap: 24px; flex-wrap: wrap; }
  .stat { min-width: 140px; }
  .stat-value { font-size: 24px; font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <h1>CloseCheck ops dashboard</h1>
  <p class="freshness">Generated ${generatedAt.toISOString()} (UTC) — spec.md §11 metrics, founder-only, generated offline</p>

  <div class="card">
    <h2>Funnel</h2>
    ${renderFunnel(data.funnel)}
  </div>

  <div class="card">
    <h2>Signups &amp; audits, last 30 days</h2>
    ${renderDailyChart(data.daily)}
  </div>

  <div class="grid-2">
    <div class="card">
      <h2>Billing status</h2>
      ${renderLabeledCounts(data.billingByStatus, "No orgs yet.", (label) => STATUS_COLOR[label])}
    </div>
    <div class="card">
      <h2>Billing plan</h2>
      ${renderLabeledCounts(data.billingByPlan, "No billing accounts yet.")}
    </div>
  </div>

  <div class="card">
    <h2>Credits &amp; overage</h2>
    <div class="stat-row">
      <div class="stat">
        <div class="stat-value">${data.totalCreditBalance}</div>
        <div class="stat-label">Total outstanding credit balance (all orgs)</div>
      </div>
      <div class="stat">
        <div class="stat-value">${data.overageLast30d.total}</div>
        <div class="stat-label">Overage entries, last 30 days</div>
      </div>
      <div class="stat">
        <div class="stat-value">${data.overageLast30d.billable} <span style="font-size:14px;color:var(--muted)">(${overagePctBillable})</span></div>
        <div class="stat-label">...of which billable</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Top error sources, last 7 days</h2>
    ${renderLabeledCounts(data.topErrorsLast7d, "No errors recorded.")}
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const outputPath = resolve(process.argv[2] ?? "./.local-ops/dashboard.html");
  const data = await fetchDashboardData();
  const html = renderDashboardHtml(data, new Date());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  console.log(outputPath);
}

// ESM equivalent of Node's `require.main === module` guard: lets this file be imported by the test
// suite (for renderDashboardHtml/pct/last30UtcDays) without also running main() and requiring a live
// database just to load the module.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => directPrisma.$disconnect());
}
