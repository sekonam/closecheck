import { Severity, Tier } from "@prisma/client";
import { computeSeverityRollup, type Coverage, type FindingForRollup } from "./rollup";
import { REPORT_DISCLAIMER_TEXT } from "./disclaimer";

export interface ReportFinding extends FindingForRollup {
  id: string;
  note: string | null;
  status: string;
  structuredData?: unknown;
  evidenceCount?: number;
  templateItem: { tier: Tier; title: string; description: string | null };
}

export interface AppendixDocument {
  findingTitle: string;
  tier: Tier;
  filename: string;
}

export interface ReportData {
  businessName: string;
  templateName: string;
  generatedAt: Date;
  // spec.md §6 cover: "business name, engagement date, consultant/firm branding". Optional because
  // the Engagement has no explicit "engagement date" column — the caller passes the Engagement's
  // createdAt (when the deal was opened for diligence), which is a different fact from generatedAt
  // (when this particular Report version was produced). When it is absent the cover simply omits
  // the row rather than passing off the generation date as the engagement date.
  engagementDate?: Date | null;
  // "Pre-LOI" / "Post-LOI" / "Closing" — deal stage at generation time. Optional for the same
  // reason; shown on the cover because it tells the reader how much seller cooperation was
  // available when the audit ran (spec.md §4's tier framing).
  dealStage?: string | null;
  // A data URI, not a fetchable URL: this HTML is handed straight to a headless Chromium page via
  // page.setContent (src/lib/reports/pdf.ts), which has no session/cookies to authenticate a request
  // back to an app route with — the caller (generateReport) resolves the org's stored logo bytes to
  // a data URI before building this.
  org: { name: string; brandColorHex: string | null; brandLogoDataUri: string | null };
  findings: ReportFinding[];
  overallRatingOverride?: Severity | null;
  overallRatingOverrideNote?: string | null;
  // spec.md §6: "appendix (raw uploaded documents, if the consultant opts to include them)." Omitted
  // or empty means no appendix section is rendered at all.
  appendixDocuments?: AppendixDocument[];
}

const SEVERITY_LABEL: Record<Severity, string> = {
  [Severity.GREEN]: "Green",
  [Severity.YELLOW]: "Yellow",
  [Severity.RED]: "Red",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  [Severity.GREEN]: "#15803d",
  [Severity.YELLOW]: "#b45309",
  [Severity.RED]: "#b91c1c",
};

/**
 * The non-color channel for severity. A traffic-light system printed in greyscale, photocopied, or
 * read by the ~8% of men with a red/green deficiency is unreadable if hue is the only encoding —
 * and this document is a financial deliverable a stranger reads under the consultant's name
 * (.claude/skills/consultant-ux-design/SKILL.md: "colorblind-legible, not just conventionally
 * colored"). Every severity is therefore encoded three ways at once: shape (below), the written
 * word ("Red"/"Yellow"/"Green"), and color. Shapes escalate visually — circle → diamond → triangle
 * — so severity is still ordered without hue. These are U+25CF/U+25C6/U+25B2, present in every
 * system font the renderer falls back to; do not swap them for an icon font or an SVG sprite, which
 * the offline, self-contained-HTML constraint rules out.
 */
const SEVERITY_GLYPH: Record<Severity, string> = {
  [Severity.GREEN]: "●",
  [Severity.YELLOW]: "◆",
  [Severity.RED]: "▲",
};

/** The same non-color treatment for the two "nothing to rate here" states. */
const UNRATED_GLYPH = "○";

const TIER_LABEL: Record<Tier, string> = {
  A: "Tier A — External (no seller cooperation needed)",
  B: "Tier B — Seller/broker-provided documents",
  C: "Tier C — Live access verification",
};

const TIER_SHORT: Record<Tier, string> = { A: "Tier A", B: "Tier B", C: "Tier C" };

// spec.md §6: "each finding showing status, severity, note, evidence" — status alone (not just
// severity) is what tells a reader *why* something has no rating: not started yet, actively blocked
// by the seller, or genuinely not applicable to this business. Collapsing all of those into a bare
// "not rated" (the prior behavior) lost that distinction in the one artifact a buyer actually reads.
const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  PASS: "Pass",
  FAIL: "Fail",
  NOT_APPLICABLE: "Not applicable",
  BLOCKED: "Blocked",
};

const NEUTRAL_TEXT = "#475569";
/** Was #94a3b8 (slate-400) at 11px — roughly 2.6:1 on white, below the WCAG AA floor and visibly
 * washed out in print, where a badge's supporting micro-copy is exactly what a reader squints at.
 * slate-500 at 11.5px clears 4.5:1. */
const MUTED_TEXT = "#64748b";

const DEFAULT_ACCENT = "#0f172a";

/**
 * The org's brand color lands inside `style="…"` attributes all over this document, so it is
 * validated rather than trusted: anything that is not a plain 3- or 6-digit hex color falls back to
 * the default slate. Not currently reachable by an attacker (the value is set through a validated
 * settings form), but an unvalidated string interpolated into a style attribute is a CSS-injection
 * shape, and this renderer is the last point where that can be caught.
 */
export function normalizeAccentColor(hex: string | null | undefined): string {
  if (!hex) return DEFAULT_ACCENT;
  const trimmed = hex.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).toLowerCase().split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return DEFAULT_ACCENT;
}

/**
 * Text color to put on top of an arbitrary brand accent. The consultant picks their own brand color
 * and the product has no say in it — a firm whose accent is pale gold gets white-on-gold table
 * headers that are unreadable in print unless the foreground flips. WCAG relative luminance, 0.5 as
 * the crossover (the point where contrast against white and against near-black are equal).
 */
export function readableTextOn(hex: string): string {
  const normalized = normalizeAccentColor(hex);
  const channel = (start: number): number => {
    const v = parseInt(normalized.slice(start, start + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? "#0f172a" : "#ffffff";
}

/** A very light wash of the accent, for table-header and panel backgrounds where full-strength
 * accent would fight the severity colors for attention. Alpha keeps it correct for any hue. */
export function accentWash(hex: string, alpha = 0.08): string {
  const normalized = normalizeAccentColor(hex);
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Only `data:image/…` URIs are ever emitted into an `<img src>`. The value is server-derived today
 * (generateReport reads the org's stored logo bytes and base64-encodes them), so this is defense in
 * depth rather than a live hole — but `src` is an attribute that executes for some schemes
 * (`javascript:` in older engines) and this is the only place the value is turned into markup.
 */
export function safeImageDataUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(uri.trim())
    ? uri.trim()
    : null;
}

export interface SeverityCounts {
  red: number;
  yellow: number;
  green: number;
  /** Findings still in play (not NOT_APPLICABLE) that carry no severity yet. */
  unrated: number;
  notApplicable: number;
}

/**
 * Counts for the executive summary. Mirrors computeSeverityRollup's exclusion rule exactly —
 * NOT_APPLICABLE findings are a resolution, not pending work, so they are counted separately and
 * never fold into `unrated`. If rollup.ts's exclusion rule ever changes, this must change with it
 * or the summary panel will disagree with the badges beside it.
 */
export function countFindingsBySeverity(findings: ReportFinding[]): SeverityCounts {
  const counts: SeverityCounts = { red: 0, yellow: 0, green: 0, unrated: 0, notApplicable: 0 };
  for (const f of findings) {
    if (f.status === "NOT_APPLICABLE") {
      counts.notApplicable++;
      continue;
    }
    if (f.severity === Severity.RED) counts.red++;
    else if (f.severity === Severity.YELLOW) counts.yellow++;
    else if (f.severity === Severity.GREEN) counts.green++;
    else counts.unrated++;
  }
  return counts;
}

/**
 * The Red findings, in tier order, for the summary's "what drove this rating" list. spec.md §6's
 * roll-up rule means a single Red turns the whole audit Red — without naming which item did it, the
 * traffic light tells a buyer's advisor that something is wrong but not what, which is the one
 * question they will actually ask the consultant.
 */
export function topRiskFindings(findings: ReportFinding[], limit = 8): ReportFinding[] {
  const tierOrder: Record<Tier, number> = { A: 0, B: 1, C: 2 };
  return findings
    .filter((f) => f.status !== "NOT_APPLICABLE" && f.severity === Severity.RED)
    .sort((a, b) => tierOrder[a.templateItem.tier] - tierOrder[b.templateItem.tier])
    .slice(0, limit);
}

function badge(severity: Severity, size: "sm" | "md" = "sm"): string {
  const pad = size === "md" ? "4px 14px" : "2px 10px";
  const font = size === "md" ? "15px" : "12px";
  return `<span style="display:inline-block;padding:${pad};border-radius:999px;font-size:${font};font-weight:600;color:#fff;background:${SEVERITY_COLOR[severity]};white-space:nowrap"><span style="font-size:${size === "md" ? "13px" : "11px"};vertical-align:1px">${SEVERITY_GLYPH[severity]}</span> ${SEVERITY_LABEL[severity]}</span>`;
}

function neutralBadge(label: string): string {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:${NEUTRAL_TEXT};background:#e2e8f0;white-space:nowrap"><span style="font-size:11px;vertical-align:1px">${UNRATED_GLYPH}</span> ${escapeHtml(label)}</span>`;
}

/**
 * A severity badge is a claim that something was checked. Found via UI testing (not caught by unit
 * tests, which only exercised the pure rollup math): a brand-new audit with zero rated findings
 * rendered "Overall: Green" with no indication nothing had been checked — reading as "verified
 * safe" rather than "not started." Never render `badge(rollup.overall)` or `badge(rollup.perTier[x])`
 * directly in this file again without checking coverage.rated first.
 */
function badgeWithCoverage(severity: Severity, coverage: Coverage, size: "sm" | "md" = "sm"): string {
  const coverageNote = `<span style="color:${MUTED_TEXT};font-size:11.5px;font-weight:400"> (${coverage.rated}/${coverage.total} rated)</span>`;
  // total === 0 means every item here was marked NOT_APPLICABLE (computeSeverityRollup excludes
  // them from the denominator entirely) — that's a resolved state, not pending work, so it must
  // read differently from "Not yet rated" (total > 0, rated === 0) even though both cases have
  // rated === 0.
  if (coverage.total === 0) return `${neutralBadge("Not applicable")}${coverageNote}`;
  if (coverage.rated === 0) return `${neutralBadge("Not yet rated")}${coverageNote}`;
  return `${badge(severity, size)}${coverageNote}`;
}

function formatDate(date: Date): string {
  // Deliberately the ISO calendar date, not a locale format: this document is read in several
  // countries and "03/04/2026" is genuinely ambiguous in a legal deliverable.
  return date.toISOString().slice(0, 10);
}

/**
 * Print/pagination rules. These cannot be expressed as inline styles (the `@page` at-rule and
 * `display:table-header-group` on a repeated <thead> have no inline equivalent), so this is the one
 * stylesheet in the document — everything visual stays inline, per the existing convention.
 *
 * The defect these fix: without `break-inside: avoid` a finding's title landed at the bottom of one
 * page and its severity badge at the top of the next, i.e. a row of the deliverable that says
 * nothing about risk followed by a Red badge attached to no title.
 */
const PRINT_STYLES = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page-break-after { break-after: page; page-break-after: always; }
  .keep-together { break-inside: avoid; page-break-inside: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
  section { break-inside: auto; }
`;

/**
 * Renders the Report to a self-contained HTML string — the same rendering used for the on-screen
 * preview and, via src/lib/reports/pdf.ts, the PDF export. Deliberately does not import Tailwind's
 * runtime (the PDF pipeline renders this in an isolated Chromium page with no build step attached);
 * inline styles only, per docs/spec.md §6.
 *
 * Whitelabel (spec.md §6): the org's brand color drives the accent throughout — cover band, section
 * rules, table headers, and the running header/footer Chromium stamps on every page; CloseCheck's
 * own branding is limited to a single small closing line, never competing with the consultant's own
 * brand kit (.claude/skills/consultant-ux-design/SKILL.md).
 *
 * The two <template> elements are not decoration: page 2..N chrome is drawn by Chromium from its
 * own `headerTemplate`/`footerTemplate` options, which live outside the document. Emitting them
 * here — and having renderHtmlToPdf lift them back out — keeps one function responsible for what
 * the document looks like, including the parts the print engine draws. See pdf.ts.
 */
export function renderReportHtml(data: ReportData): string {
  const rollup = computeSeverityRollup(data.findings);
  const accent = normalizeAccentColor(data.org.brandColorHex);
  const accentText = readableTextOn(accent);
  const logo = safeImageDataUri(data.org.brandLogoDataUri);
  const counts = countFindingsBySeverity(data.findings);
  const byTier: Record<Tier, ReportFinding[]> = { A: [], B: [], C: [] };
  for (const f of data.findings) byTier[f.templateItem.tier].push(f);

  const overrideBlock = overrideSection(data, rollup, accent);

  const tierSections = (Object.keys(TIER_LABEL) as Tier[])
    .map((tier) => {
      const items = byTier[tier];
      if (items.length === 0) return "";
      const rows = items.map((f) => findingRow(f)).join("");

      return `
      <section style="margin-top:26px">
        <h3 class="keep-together" style="font-size:16px;margin:0 0 10px 0;padding-left:10px;border-left:4px solid ${accent};line-height:1.45">
          <span style="display:block">${TIER_LABEL[tier]}</span>
          <span style="display:block;margin-top:4px;font-weight:400">${badgeWithCoverage(rollup.perTier[tier], rollup.perTierCoverage[tier])}</span>
        </h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1">
          <thead>
            <tr style="background:${accent};color:${accentText}">
              <th style="text-align:left;padding:6px 12px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600">${escapeHtml(TIER_SHORT[tier])} finding</th>
              <th style="text-align:right;padding:6px 12px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;white-space:nowrap">Status &amp; rating</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Technology Due-Diligence Report — ${escapeHtml(data.businessName)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#0f172a; margin:0; padding:0; font-size:13px; line-height:1.5">
${pdfHeaderTemplate(data, accent, logo)}
${pdfFooterTemplate(data, accent)}
${coverPage(data, accent, accentText, logo, rollup.overall, rollup.overallCoverage)}
${executiveSummary(data, accent, accentText, rollup, counts, overrideBlock)}
${tierSections}
${appendixSection(data.appendixDocuments, accent, accentText)}
${closingBlock(data, accent, logo)}
</body>
</html>`;
}

/**
 * spec.md §6's cover: "business name, engagement date, consultant/firm branding". Previously a
 * compact header band shared with the first page of content, with no engagement date at all — so
 * the first thing a buyer saw was a dense table rather than a titled document from a named firm.
 * A full page, ending in `break-after: page`, so the detail always starts clean.
 */
function coverPage(
  data: ReportData,
  accent: string,
  accentText: string,
  logo: string | null,
  overall: Severity,
  coverage: Coverage,
): string {
  const metaRow = (label: string, value: string): string => `
    <tr>
      <td style="padding:5px 0;font-size:12px;color:${MUTED_TEXT};text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;vertical-align:top;width:170px">${escapeHtml(label)}</td>
      <td style="padding:5px 0;font-size:14px;color:#0f172a;vertical-align:top">${escapeHtml(value)}</td>
    </tr>`;

  return `
  <section class="page-break-after" style="min-height:235mm;padding:6mm 0 0 0;display:flex;flex-direction:column">
    <div style="flex:0 0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
        <div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.14em;color:${MUTED_TEXT}">Prepared by</div>
          <div style="font-weight:700;font-size:20px;margin-top:4px">${escapeHtml(data.org.name)}</div>
        </div>
        ${logo ? `<img src="${escapeAttr(logo)}" alt="${escapeAttr(data.org.name)} logo" style="max-height:64px;max-width:220px;object-fit:contain" />` : ""}
      </div>
      <div style="height:6px;background:${accent};margin:18px 0 0 0"></div>
    </div>

    <div style="flex:1 1 auto;padding-top:44px">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.18em;color:${accent === "#0f172a" ? MUTED_TEXT : accent};font-weight:600">Technology Due-Diligence Report</div>
      <h1 style="margin:12px 0 0 0;font-size:38px;line-height:1.15;letter-spacing:-0.01em">${escapeHtml(data.businessName)}</h1>

      <div class="keep-together" style="margin-top:28px;display:inline-block;padding:12px 18px;border:1px solid #cbd5e1;border-left:6px solid ${accent};background:#f8fafc">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${MUTED_TEXT}">Overall rating (computed from the findings)</div>
        <div style="margin-top:6px">${badgeWithCoverage(overall, coverage, "md")}</div>
        ${
          data.overallRatingOverride
            ? `<div style="margin-top:8px;font-size:12px;color:${NEUTRAL_TEXT}">Consultant override: ${badge(data.overallRatingOverride)} <span style="color:${MUTED_TEXT}">— see the executive summary for the consultant's reasoning.</span></div>`
            : ""
        }
      </div>

      <table style="margin-top:34px;border-collapse:collapse">
        ${data.engagementDate ? metaRow("Engagement date", formatDate(data.engagementDate)) : ""}
        ${data.dealStage ? metaRow("Deal stage", data.dealStage) : ""}
        ${metaRow("Audit template", data.templateName)}
        ${metaRow("Report generated", formatDate(data.generatedAt))}
      </table>
    </div>

    <div class="keep-together" style="flex:0 0 auto;margin-top:32px;padding:12px 16px;border-top:1px solid #cbd5e1;background:${accentWash(accent, 0.05)}">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${MUTED_TEXT};font-weight:600">Scope &amp; limitations</div>
      <p style="margin:6px 0 0 0;font-size:11.5px;line-height:1.6;color:${NEUTRAL_TEXT}">${escapeHtml(REPORT_DISCLAIMER_TEXT)}</p>
    </div>
  </section>`;
}

/**
 * spec.md §6's traffic-light executive summary, and per the consultant-ux-design skill the page to
 * design as if it is the only one some readers open. The previous version was three text labels in
 * a row: it told a reader the audit was Red but not which items made it Red — so the first question
 * the deliverable provoked ("what's the problem?") could only be answered by reading every tier
 * table. This adds the two things that answer it in one glance: the per-severity item counts, and
 * the Red findings by name.
 */
function executiveSummary(
  data: ReportData,
  accent: string,
  accentText: string,
  rollup: ReturnType<typeof computeSeverityRollup>,
  counts: SeverityCounts,
  overrideBlock: string,
): string {
  const countCell = (label: string, value: number, color: string, glyph: string): string => `
    <td style="padding:10px 6px;text-align:center;border:1px solid #cbd5e1;background:#ffffff;width:20%">
      <div style="font-size:22px;font-weight:700;color:${color};line-height:1.1">${value}</div>
      <div style="margin-top:3px;font-size:11.5px;color:${NEUTRAL_TEXT};white-space:nowrap"><span style="color:${color}">${glyph}</span> ${escapeHtml(label)}</div>
    </td>`;

  const tierRow = (tier: Tier): string => {
    const tierFindings = data.findings.filter((f) => f.templateItem.tier === tier);
    const tierCounts = countFindingsBySeverity(tierFindings);
    // A tier the template contains no items for at all is a different statement from a tier whose
    // items were all marked "not applicable" to this business — badgeWithCoverage cannot tell them
    // apart (both are 0/0), and printing "Not applicable" for a tier nobody was ever asked about
    // overstates how much of the audit is resolved.
    const rating =
      tierFindings.length === 0
        ? `${neutralBadge("No items")}<span style="color:${MUTED_TEXT};font-size:11.5px"> (not in this template)</span>`
        : badgeWithCoverage(rollup.perTier[tier], rollup.perTierCoverage[tier]);
    return `
    <tr>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;white-space:nowrap">${escapeHtml(TIER_SHORT[tier])}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:${NEUTRAL_TEXT}">${escapeHtml(TIER_LABEL[tier].replace(/^Tier [ABC] — /, ""))}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:${NEUTRAL_TEXT};white-space:nowrap">${tierCounts.red} ${SEVERITY_GLYPH.RED} · ${tierCounts.yellow} ${SEVERITY_GLYPH.YELLOW} · ${tierCounts.green} ${SEVERITY_GLYPH.GREEN}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${rating}</td>
    </tr>`;
  };

  const risks = topRiskFindings(data.findings);
  const totalRed = counts.red;
  const risksBlock =
    risks.length > 0
      ? `
    <div class="keep-together" style="margin-top:18px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${MUTED_TEXT};font-weight:600">What drove the rating — ${totalRed} Red ${totalRed === 1 ? "item" : "items"}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px">
        ${risks
          .map(
            (f) => `
        <tr>
          <td style="padding:6px 10px 6px 0;vertical-align:top;width:18px;color:${SEVERITY_COLOR.RED};font-size:13px">${SEVERITY_GLYPH.RED}</td>
          <td style="padding:6px 8px 6px 0;vertical-align:top;font-size:12px;color:${MUTED_TEXT};white-space:nowrap;width:56px">${escapeHtml(TIER_SHORT[f.templateItem.tier])}</td>
          <td style="padding:6px 0;vertical-align:top;font-size:13px;font-weight:600">${escapeHtml(f.templateItem.title)}${
            f.note
              ? `<div style="margin-top:2px;font-size:12px;font-weight:400;color:${NEUTRAL_TEXT}">${escapeHtml(truncate(f.note, 160))}</div>`
              : ""
          }</td>
        </tr>`,
          )
          .join("")}
      </table>
      ${totalRed > risks.length ? `<div style="margin-top:6px;font-size:12px;color:${MUTED_TEXT}">+ ${totalRed - risks.length} further Red ${totalRed - risks.length === 1 ? "item" : "items"} in the detail section.</div>` : ""}
    </div>`
      : `
    <div class="keep-together" style="margin-top:18px;font-size:12.5px;color:${NEUTRAL_TEXT}">
      ${
        counts.red === 0 && rollup.overallCoverage.rated > 0
          ? "No Red items were identified in this audit."
          : "No Red items yet — note that " +
            (rollup.overallCoverage.total - rollup.overallCoverage.rated) +
            " of " +
            rollup.overallCoverage.total +
            " applicable items are still unrated, so this is not a clean bill of health."
      }
    </div>`;

  return `
  <section style="margin-top:0">
    <h2 style="font-size:18px;margin:0 0 12px 0;padding-left:10px;border-left:4px solid ${accent}">Executive summary</h2>

    <div class="keep-together" style="padding:16px 18px;border:1px solid #cbd5e1;background:${accentWash(accent, 0.05)}">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${NEUTRAL_TEXT}">Overall</span>
        ${badgeWithCoverage(rollup.overall, rollup.overallCoverage, "md")}
      </div>
      ${overrideBlock}
      <table style="width:100%;border-collapse:collapse;margin-top:14px">
        <tr>
          ${countCell("Red", counts.red, SEVERITY_COLOR.RED, SEVERITY_GLYPH.RED)}
          ${countCell("Yellow", counts.yellow, SEVERITY_COLOR.YELLOW, SEVERITY_GLYPH.YELLOW)}
          ${countCell("Green", counts.green, SEVERITY_COLOR.GREEN, SEVERITY_GLYPH.GREEN)}
          ${countCell("Unrated", counts.unrated, NEUTRAL_TEXT, UNRATED_GLYPH)}
          ${countCell("N/A", counts.notApplicable, NEUTRAL_TEXT, "—")}
        </tr>
      </table>
      ${risksBlock}
    </div>

    <table style="width:100%;border-collapse:collapse;margin-top:16px;border:1px solid #cbd5e1">
      <thead>
        <tr style="background:${accent};color:${accentText}">
          <th style="text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Tier</th>
          <th style="text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">What it covers</th>
          <th style="text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap">${SEVERITY_GLYPH.RED} / ${SEVERITY_GLYPH.YELLOW} / ${SEVERITY_GLYPH.GREEN}</th>
          <th style="text-align:right;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Rating</th>
        </tr>
      </thead>
      <tbody>
        ${(Object.keys(TIER_LABEL) as Tier[]).map(tierRow).join("")}
      </tbody>
    </table>

    <div class="keep-together" style="margin-top:10px;font-size:11.5px;color:${NEUTRAL_TEXT}">
      <strong style="color:#0f172a">How to read the ratings:</strong>
      <span style="white-space:nowrap;margin-left:6px"><span style="color:${SEVERITY_COLOR.RED}">${SEVERITY_GLYPH.RED}</span> Red — material issue</span>
      <span style="white-space:nowrap;margin-left:12px"><span style="color:${SEVERITY_COLOR.YELLOW}">${SEVERITY_GLYPH.YELLOW}</span> Yellow — needs attention</span>
      <span style="white-space:nowrap;margin-left:12px"><span style="color:${SEVERITY_COLOR.GREEN}">${SEVERITY_GLYPH.GREEN}</span> Green — no issue found</span>
      <span style="white-space:nowrap;margin-left:12px"><span style="color:${NEUTRAL_TEXT}">${UNRATED_GLYPH}</span> not yet rated</span>.
      A tier is rated by its worst item: one Red item makes the tier Red regardless of how many Greens surround it.
    </div>
  </section>`;
}

/**
 * spec.md §6: the consultant's override of the computed overall rating "is always shown alongside
 * the computed rating, never silently replacing it."
 *
 * This deliberately renders whenever an override exists — including when it happens to EQUAL the
 * computed rating. The prior `override !== computed` guard silently dropped the whole block in that
 * case, which is the case where the consultant's *note* carries the most weight: "computed Red and
 * I also rate it Red because the seller refused Tier C verification" is reasoning the buyer needs,
 * and the consultant had every reason to believe it shipped (the audit page still showed it in the
 * form). Never reintroduce an equality condition here.
 *
 * The computed value is re-stated inside the block rather than referred to as "the rating above",
 * because "above" is wrong in the zero-coverage case: the summary badge then reads "Not yet rated"
 * and there is no computed severity on display to point at.
 */
function overrideSection(
  data: ReportData,
  rollup: ReturnType<typeof computeSeverityRollup>,
  accent: string,
): string {
  const override = data.overallRatingOverride;
  if (!override) return "";

  const agrees = override === rollup.overall && rollup.overallCoverage.rated > 0;

  return `<div class="keep-together" style="margin-top:12px;padding:10px 14px;border:1px solid #cbd5e1;border-left:4px solid ${accent};background:#ffffff;font-size:13px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${MUTED_TEXT};font-weight:600">Consultant override${agrees ? " (matches the computed rating)" : ""}</div>
      <div style="margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="color:${NEUTRAL_TEXT}">Consultant's rating:</span> ${badge(override)}
        <span style="color:${NEUTRAL_TEXT}">Computed from the findings:</span> ${badgeWithCoverage(rollup.overall, rollup.overallCoverage)}
      </div>
      <div style="margin-top:4px;font-size:11.5px;color:${MUTED_TEXT}">Both values are shown deliberately — the consultant's judgement does not replace the computed roll-up.</div>
      ${data.overallRatingOverrideNote ? `<div style="margin-top:6px;color:#334155">${escapeHtml(data.overallRatingOverrideNote)}</div>` : ""}
    </div>`;
}

function findingRow(f: ReportFinding): string {
  const structured = (f.structuredData ?? null) as
    | { transferable?: string | null; penaltyAmount?: string | null; penaltyBasis?: string | null }
    | null;
  const structuredParts = structured
    ? [
        structured.transferable ? `Transferable: ${escapeHtml(structured.transferable)}` : null,
        structured.penaltyAmount ? `Penalty: ${escapeHtml(structured.penaltyAmount)}` : null,
        structured.penaltyBasis ? `Basis: ${escapeHtml(structured.penaltyBasis)}` : null,
      ].filter((v): v is string => Boolean(v))
    : [];

  // A NOT_APPLICABLE finding never presents a severity badge, whatever severity value is still
  // sitting on the row. computeSeverityRollup (rollup.ts) excludes these findings from both the
  // severity computation and the coverage denominator, so a stale Red severity on a row the
  // consultant later marked "not applicable" — one Save, two fields, easy to leave behind — used to
  // print a Red badge inside a tier whose own header read "Green (n/n rated)". A visible
  // self-contradiction in the client deliverable is worse than either value alone; the row's own
  // status ("Not applicable") is the honest thing to show. This is badgeWithCoverage's rule one
  // level down: never render a severity that the roll-up did not count.
  const suppressSeverity = f.status === "NOT_APPLICABLE";
  const severity = suppressSeverity ? null : f.severity;

  // The severity rail: a second, positional encoding of severity that survives greyscale printing
  // and sits on the same row as the title, so a scanning reader finds the bad rows without reading
  // the right-hand column at all.
  const rail = severity ? SEVERITY_COLOR[severity] : "#cbd5e1";

  return `
        <tr class="keep-together" style="border-bottom:1px solid #e2e8f0">
          <td style="padding:9px 12px;vertical-align:top;width:72%;border-left:4px solid ${rail}">
            <div style="font-weight:600">${escapeHtml(f.templateItem.title)}</div>
            ${f.templateItem.description ? `<div style="color:${NEUTRAL_TEXT};font-size:12.5px;margin-top:2px">${escapeHtml(f.templateItem.description)}</div>` : ""}
            ${f.note ? `<div style="margin-top:6px;font-size:12.5px;color:#334155"><em>Finding:</em> ${escapeHtml(f.note)}</div>` : ""}
            ${structuredParts.length > 0 ? `<div style="margin-top:4px;font-size:12px;color:${NEUTRAL_TEXT}">${structuredParts.join(" · ")}</div>` : ""}
            ${f.evidenceCount ? `<div style="margin-top:4px;font-size:12px;color:#0369a1">${f.evidenceCount} document${f.evidenceCount === 1 ? "" : "s"} attached</div>` : ""}
          </td>
          <td style="padding:9px 12px;text-align:right;vertical-align:top">
            <div style="font-size:11.5px;color:${MUTED_TEXT};margin-bottom:4px;white-space:nowrap">${escapeHtml(STATUS_LABEL[f.status] ?? f.status)}</div>
            ${severity ? badge(severity) : neutralBadge(suppressSeverity ? "Not applicable" : "Not rated")}
          </td>
        </tr>`;
}

/**
 * Lists the raw uploaded documents referenced by the audit's findings (spec.md §6's appendix), only
 * when the consultant opted in via the "Include uploaded documents" checkbox on generateReport. A
 * listed reference (filename, which finding/tier it's evidence for) rather than embedding file
 * contents inline — most uploaded documents are contracts/PDFs, not images, and the report itself is
 * the deliverable, not a document viewer.
 */
function appendixSection(
  documents: AppendixDocument[] | undefined,
  accent: string,
  accentText: string,
): string {
  if (!documents || documents.length === 0) return "";

  const rows = documents
    .map(
      (d) => `
    <tr class="keep-together" style="border-bottom:1px solid #e2e8f0">
      <td style="padding:6px 12px;font-size:12.5px">${escapeHtml(d.filename)}</td>
      <td style="padding:6px 12px;font-size:12px;color:${NEUTRAL_TEXT}">${escapeHtml(d.findingTitle)}</td>
      <td style="padding:6px 12px;font-size:12px;color:${NEUTRAL_TEXT};white-space:nowrap">Tier ${d.tier}</td>
    </tr>`,
    )
    .join("");

  return `
  <section style="margin-top:26px">
    <h3 style="font-size:16px;margin:0 0 10px 0;padding-left:10px;border-left:4px solid ${accent}">Appendix — Uploaded documents</h3>
    <p style="font-size:12px;color:${NEUTRAL_TEXT};margin:0 0 10px 0">Raw documents provided as evidence during this audit, listed for reference. Retained and access-controlled per the firm's document retention policy — not reproduced inline here.</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1">
      <thead>
        <tr style="background:${accent};color:${accentText}">
          <th style="text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Document</th>
          <th style="text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Evidence for</th>
          <th style="text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Tier</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

/** Closing block. The disclaimer text is repeated verbatim from the single constant (never
 * reflowed or paraphrased — spec.md §6 makes the wording a legal-review item) because a reader who
 * enters the document at the detail section may never see the cover. */
function closingBlock(data: ReportData, accent: string, logo: string | null): string {
  return `
  <section class="keep-together" style="margin-top:34px;padding-top:14px;border-top:3px solid ${accent}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      ${logo ? `<img src="${escapeAttr(logo)}" alt="" style="height:18px;width:auto;object-fit:contain" />` : ""}
      <span style="font-weight:700;font-size:13px">${escapeHtml(data.org.name)}</span>
      <span style="color:${MUTED_TEXT};font-size:11.5px">· ${escapeHtml(data.businessName)} · ${formatDate(data.generatedAt)}</span>
    </div>
    <p style="margin:0;font-size:11.5px;line-height:1.6;color:${NEUTRAL_TEXT}">${escapeHtml(REPORT_DISCLAIMER_TEXT)}</p>
    <p style="margin:8px 0 0 0;font-size:10.5px;color:${MUTED_TEXT}">Prepared using CloseCheck.</p>
  </section>`;
}

/**
 * The running header Chromium stamps into the top margin of EVERY page (src/lib/reports/pdf.ts
 * lifts this out of the document and passes it as `headerTemplate`). Before this existed, pages
 * 2..N of a multi-page report carried no firm name, no logo and no accent at all — a buyer holding
 * page 4 of a printed report had nothing identifying whose work it was.
 *
 * Chromium's header/footer templates are rendered in an isolated context that ignores the
 * document's stylesheet, defaults to a ~0 font size, and drops non-data: images — hence the fully
 * inlined styles, the explicit font-size on every element, and the data-URI-only logo.
 */
function pdfHeaderTemplate(data: ReportData, accent: string, logo: string | null): string {
  return `<template id="closecheck-pdf-header"><div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:8px;color:#64748b;padding:0 14mm;box-sizing:border-box;">
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${accent};padding-bottom:3px;">
    <div style="display:flex;align-items:center;">
      ${logo ? `<img src="${escapeAttr(logo)}" style="height:10px;width:auto;object-fit:contain;margin-right:5px;" />` : ""}
      <span style="font-size:8px;font-weight:700;color:#334155;">${escapeHtml(data.org.name)}</span>
    </div>
    <span style="font-size:8px;color:#64748b;">${escapeHtml(truncate(data.businessName, 48))} — Technology Due-Diligence Report</span>
  </div>
</div></template>`;
}

/**
 * The running footer, same mechanism as the header: firm name and accent band on every page, plus
 * the page numbering Chromium substitutes into `.pageNumber`/`.totalPages` (those two class names
 * are the print engine's contract — renaming them silently produces blank page numbers).
 */
function pdfFooterTemplate(data: ReportData, accent: string): string {
  return `<template id="closecheck-pdf-footer"><div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:8px;color:#64748b;padding:0 14mm;box-sizing:border-box;">
  <div style="border-top:2px solid ${accent};padding-top:3px;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:8px;color:#64748b;">${escapeHtml(data.org.name)} · Confidential — prepared for the recipient of this report</span>
    <span style="font-size:8px;color:#334155;font-weight:600;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div></template>`;
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1).trimEnd()}…`;
}

/**
 * HTML text escaping. `'` is escaped too: it is harmless inside a double-quoted attribute, but this
 * function is used for attribute values as well as text nodes (see escapeAttr), and the next person
 * to reach for it should not have to know which quoting style the call site used.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Explicit alias for values that land inside an attribute — same escaping, but the call site says
 * what it is doing. Every `src`/`alt` in this file goes through it. */
export function escapeAttr(input: string): string {
  return escapeHtml(input);
}
