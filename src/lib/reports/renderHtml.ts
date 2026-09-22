import { CheckMethod, Severity, Tier } from "@prisma/client";
import { formatFileSize } from "@/lib/storage/describeEvidence";
import { describeMimeType } from "@/lib/storage/uploadPolicy";
import {
  formatFieldValue,
  hasAnyFieldValue,
  parseFieldSchema,
  readPersistedValues,
  type ColumnDef,
  type FieldDef,
  type ItemFieldSchema,
} from "@/lib/templates/fieldSchema";
import { computeSeverityRollup, type Coverage, type FindingForRollup } from "./rollup";
import { formatCitation, type ResolvedCitation } from "@/lib/audit/sourceRef";

import { REPORT_DISCLAIMER_TEXT } from "./disclaimer";

export interface ReportFinding extends FindingForRollup {
  id: string;
  note: string | null;
  status: string;
  /**
   * Whatever was captured for this finding, in one of three shapes — see `structuredFields` below,
   * which is the only thing in this file that reads it. Never rendered raw.
   */
  structuredData?: unknown;
  evidenceCount?: number;
  /**
   * Where each structured answer came from, keyed by field. Rendered inline beneath the value it
   * substantiates — this is the difference between the report asserting something and the report
   * showing a reader the clause it read it from (docs/spec.md §2.1).
   */
  citations?: Map<string, ResolvedCitation[]>;
  /**
   * Deliberately a narrow projection of TemplateItem rather than the row itself: `guidance` and
   * `severityGuidance` are INTERNAL methodology (see prisma/schema.prisma's TemplateItem — they are
   * the product's IP and were split out of `description` precisely because internal text had leaked
   * into a client deliverable). `description` is the only client-facing string on that row, and
   * nothing in this file may render any field not named here.
   */
  templateItem: {
    tier: Tier;
    title: string;
    description: string | null;
    /** Template v3+. Absent on v1/v2 items and on Tier A automated ones. */
    fieldSchema?: unknown;
    /** Absent in older callers; treated as MANUAL. See `structuredFields`. */
    method?: CheckMethod;
  };
}

export interface AppendixDocument {
  findingTitle: string;
  tier: Tier;
  filename: string;
  /** The consultant's own name for the document, where they gave one. */
  label: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** The named professional who attached it — spec.md §4's attestation model needs a person. */
  attributedTo: string | null;
  attachedAt: Date;
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
  // spec.md §6's appendix: a listing of the documents relied on, never the documents themselves
  // (see the decision recorded there, and appendixSection below for the reasoning). Omitted
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

/** WCAG relative luminance of a normalized hex color. */
function relativeLuminance(hex: string): number {
  const normalized = normalizeAccentColor(hex);
  const channel = (start: number): number => {
    const v = parseInt(normalized.slice(start, start + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Contrast ratio of a color against the white page this document is printed on. */
function contrastWithPage(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/**
 * Text color to put on top of an arbitrary brand accent. The consultant picks their own brand color
 * and the product has no say in it — a firm whose accent is pale gold gets white-on-gold table
 * headers that are unreadable in print unless the foreground flips.
 *
 * The crossover is the luminance at which contrast against #ffffff and against #0f172a are equal:
 * (L+0.05)/0.0614 = 1.05/(L+0.05) solves to L ≈ 0.204. It was previously 0.4, which is nowhere in
 * particular — a fill at L = 0.35 got white text at 2.6:1 when dark text would have given 5.0:1.
 * Every color the existing tests pin (#0d7a6f, #0f172a, #facc15, #ffffff) lands on the same side of
 * 0.204 as it did of 0.4; what changes is the mid-tones between them, all of them for the better.
 */
export function readableTextOn(hex: string): string {
  return relativeLuminance(hex) > 0.204 ? "#0f172a" : "#ffffff";
}

/**
 * The accent, darkened only as far as it must be to still read as a *shape* on white paper.
 *
 * Observed in a rendered PDF: an org whose brandColorHex is "#ffffff" got a document with no
 * structure at all — the cover band, every section rule, every table-header fill and the running
 * header/footer rules were white on white. Text stayed legible (readableTextOn flips correctly), so
 * nothing looked broken; the deliverable had simply lost every visual boundary a reader navigates
 * by, with no error anywhere to say so.
 *
 * The rule is WCAG 1.4.11's non-text contrast bar, 3:1 against the page — the same line the
 * standard draws for "is this graphical object perceivable at all". An accent that already clears it
 * is returned untouched, so a consultant's deliberately-chosen brand color is never second-guessed:
 * #0d7a6f, #0f172a, and every other normal brand accent come back byte-identical. Only an accent
 * that cannot be seen is changed, and then only by scaling its sRGB channels — which holds the hue,
 * so a pale-gold firm gets a deeper gold rather than a grey, and a white firm gets a neutral grey
 * because grey is what white actually is once it has to be visible.
 *
 * Deliberately NOT applied to accent-colored *text*, which needs the stricter 4.5:1 and gets
 * `pageTextAccent` instead.
 */
export function structuralAccent(hex: string): string {
  const normalized = normalizeAccentColor(hex);
  if (contrastWithPage(normalized) >= 3) return normalized;

  const rgb = [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
  const scaled = (factor: number): string =>
    `#${rgb.map((c) => Math.round(c * factor).toString(16).padStart(2, "0")).join("")}`;

  // Binary search the largest channel scale that still clears 3:1. Monotonic in `factor`, so 24
  // iterations is far more than enough to land inside one 8-bit step.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (contrastWithPage(scaled(mid)) >= 3) low = mid;
    else high = mid;
  }
  return scaled(low);
}

/**
 * The accent used as *text* on the white page (the cover's eyebrow line). Body text needs 4.5:1,
 * which plenty of perfectly good brand accents do not reach — so rather than darkening the brand
 * color into something the firm did not choose, this falls back to the document's own muted slate
 * and leaves the brand to the places it does work (the bands, rules and fills `structuralAccent`
 * covers, plus the firm's own logo). An accent that clears 4.5:1 is used exactly as given.
 */
export function pageTextAccent(hex: string): string {
  const normalized = normalizeAccentColor(hex);
  return contrastWithPage(normalized) >= 4.5 ? normalized : MUTED_TEXT;
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

const TIER_ORDER: Record<Tier, number> = { A: 0, B: 1, C: 2 };

/**
 * The Red findings for the summary's "what drove this rating" list. spec.md §6's roll-up rule means
 * a single Red turns the whole audit Red — without naming which item did it, the traffic light tells
 * a buyer's advisor that something is wrong but not what, which is the one question they will
 * actually ask the consultant.
 *
 * Selection is round-robin across the tiers, not "sort by tier then take the first N". Observed in a
 * rendered PDF with 20 Red findings in each tier: the panel listed eight Tier A items and then
 * "+ 52 further Red items in the detail section" — so the one page some readers open showed nothing
 * from Tier B or C, which is precisely where the material findings in a deal live (spec.md §4: Tier
 * A is the external, no-cooperation-needed surface; Tier B is the seller's own contracts and
 * statements). A tier-blind slice is worse than a shorter list, because a reader has no way to tell
 * that the omission is an artifact of the ordering rather than a statement about the deal.
 *
 * Taking one from each tier in turn means every tier that has a Red is represented before any tier
 * gets a second slot, and the list still degrades correctly: with Reds in one tier only, this is
 * exactly the old behaviour. The selected findings are then re-sorted into tier order for display,
 * so the panel still reads A-then-B-then-C rather than interleaved.
 */
export function topRiskFindings(findings: ReportFinding[], limit = 8): ReportFinding[] {
  const reds = findings.filter((f) => f.status !== "NOT_APPLICABLE" && f.severity === Severity.RED);
  const queues: Record<Tier, ReportFinding[]> = { A: [], B: [], C: [] };
  for (const f of reds) queues[f.templateItem.tier].push(f);

  const picked: ReportFinding[] = [];
  for (let round = 0; picked.length < limit; round++) {
    let tookOne = false;
    for (const tier of ["A", "B", "C"] as Tier[]) {
      const next = queues[tier][round];
      if (next === undefined) continue;
      tookOne = true;
      picked.push(next);
      if (picked.length === limit) break;
    }
    if (!tookOne) break;
  }

  return picked.sort(
    (a, b) => TIER_ORDER[a.templateItem.tier] - TIER_ORDER[b.templateItem.tier],
  );
}

/**
 * A finding whose recorded status and severity say opposite things about the same item.
 *
 * Observed in a rendered PDF: a row printing status "Pass" beside a Red badge, note "Expires
 * 2029-04-01 (925 days out)" — and then listed in the executive summary's "What drove the rating"
 * panel, where its own note tells the buyer nothing is wrong. Whichever of the two fields is the
 * mistake, the reader is holding a document that contradicts itself under the consultant's name.
 *
 * WHY THE SEVERITY WINS AND THE STATUS IS STATED ANYWAY. The severity is not cosmetic here: it is
 * the value computeSeverityRollup already counted, so it is behind the tier badge, the overall
 * rating, the Red/Yellow/Green tallies and this finding's place in the risk panel. Dropping it from
 * the row would make the row disagree with every aggregate in the document that was computed from
 * it — the same failure the NOT_APPLICABLE suppression exists to prevent, just pointed the other
 * way. (That path is different and stays as it is: a NOT_APPLICABLE finding is excluded from the
 * roll-up entirely, so suppressing its badge makes the row agree with the aggregates.)
 *
 * But silently dropping the *status* is not honest either — the consultant recorded it, it is a
 * client-facing field per spec.md §6 ("each finding showing status, severity, note, evidence"), and
 * a reader who later sees it in any other artifact would find a report that had quietly hidden it.
 * So both are printed and the disagreement is named in words, which also tells the reader the
 * contradiction is real data rather than a rendering glitch, and gives them the one sentence they
 * need to raise it with the consultant.
 *
 * Only the two genuinely contradictory pairs qualify. "Blocked" or "In progress" beside a Red badge
 * is not a contradiction — an item can be unresolved *and* already known to be bad — and flagging
 * those would train readers to ignore the flag.
 */
export function statusContradictsSeverity(status: string, severity: Severity | null): boolean {
  if (severity === null) return false;
  if (status === "PASS") return severity === Severity.RED || severity === Severity.YELLOW;
  if (status === "FAIL") return severity === Severity.GREEN;
  return false;
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
 *
 * TABLE WIDTH IS NOT NEGOTIABLE (the `body`/`table` rules at the end of the block)
 * -------------------------------------------------------------------------------
 * Observed in a rendered PDF: a Tier B finding whose note carried a 600-character unbroken
 * identifier widened the tier table past the paper, and every OTHER finding's structured columns
 * were clipped off the right edge. A 40-row recurring-SaaS inventory printed its Vendor column and
 * nothing else — no monthly costs, no term ends, no account owners; the evidence appendix printed
 * Document and dropped Type, Evidence for, Tier and Provided by. `pdftotext`, plain and `-layout`,
 * confirmed the clipped columns were absent from the PDF's text layer entirely. That is data loss,
 * not visual overflow, and nothing on the page said anything was missing: a consultant would have
 * sent a buyer a SaaS inventory with no costs and an appendix with no provenance, and neither of
 * them would have had any way to know.
 *
 * `overflow-wrap: anywhere` and NOT `break-word`, because only `anywhere` reduces an element's
 * min-content width — which is exactly the number auto table layout sizes columns from, and
 * therefore the number that was pushing the table past the page. `table-layout: fixed` is the belt
 * to that braces: a table's width becomes its declared width, full stop, so no cell content of any
 * shape can widen it again. Every table in this file consequently declares a width, and its FIRST
 * row declares the column widths, because fixed layout reads the first row and ignores the rest.
 *
 * Cells that must stay atomic — money, percent, date — set `white-space: nowrap` locally. That
 * suppresses every soft wrap opportunity, so this rule cannot touch them and the earlier fix for a
 * term-end column reading "2027-02-" / "28" still holds. Only free text breaks.
 */
const PRINT_STYLES = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page-break-after { break-after: page; page-break-after: always; }
  .keep-together { break-inside: avoid; page-break-inside: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  /* The one deliberate exception to the rule above, for a finding row carrying a long structured
     table (the recurring-SaaS inventory routinely runs 5-15 rows). Such a row cannot fit on one
     page, and an un-honourable "avoid" is worse than no rule: Chromium abandons it and breaks
     wherever it likes, including through a row of the inner table. Letting the OUTER row break
     keeps the inner <tr>s' own avoid-rule honourable, so the table paginates between rows with its
     <thead> repeated, and no row is ever split across the page boundary. */
  tr.allow-break { break-inside: auto; page-break-inside: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
  section { break-inside: auto; }

  /* The two rules that stop one long token from deleting other findings' data — see the "TABLE
     WIDTH IS NOT NEGOTIABLE" note above this constant, which is where the reasoning lives. */
  body { overflow-wrap: anywhere; }
  table { table-layout: fixed; max-width: 100%; }
`;

/**
 * Renders the Report to a self-contained HTML string, which src/lib/reports/pdf.ts turns into the
 * PDF export — today its only consumer (generateReport in src/lib/actions/reports.ts). There is no
 * on-screen preview rendering this; an earlier version of this comment claimed there was. That
 * matters for how this file is edited: nothing here is validated by looking at the app, so changes
 * need a rendered PDF to be checked against.
 *
 * Deliberately does not import Tailwind's runtime (the PDF pipeline renders this in an isolated
 * Chromium page with no build step attached); inline styles only, per docs/spec.md §6 — plus the
 * single PRINT_STYLES block for the pagination rules that have no inline equivalent.
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
  // Everything downstream paints `accent` onto the white page — bands, rules, table-header fills,
  // the running header/footer, the panel washes — so the accent is resolved through
  // structuralAccent once, here. For every brand color that is already visible on paper this is the
  // identity function and the whitelabel treatment is byte-for-byte unchanged; it only bites on an
  // accent so pale that the structure it draws would not exist. See structuralAccent.
  const accent = structuralAccent(normalizeAccentColor(data.org.brandColorHex));
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
      const rows = items.map((f) => findingRow(f, accent)).join("");

      return `
      <section style="margin-top:26px">
        <h3 class="keep-together" style="font-size:16px;margin:0 0 10px 0;padding-left:10px;border-left:4px solid ${accent};line-height:1.45">
          <span style="display:block">${TIER_LABEL[tier]}</span>
          <span style="display:block;margin-top:4px;font-weight:400">${badgeWithCoverage(rollup.perTier[tier], rollup.perTierCoverage[tier])}</span>
        </h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1">
          <thead>
            <tr style="background:${accent};color:${accentText}">
              <th style="width:72%;text-align:left;padding:6px 12px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600">${escapeHtml(TIER_SHORT[tier])} finding</th>
              <th style="width:28%;text-align:right;padding:6px 12px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;white-space:nowrap">Status &amp; rating</th>
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
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.18em;color:${accent === DEFAULT_ACCENT ? MUTED_TEXT : pageTextAccent(accent)};font-weight:600">Technology Due-Diligence Report</div>
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

      <table style="width:100%;margin-top:34px;border-collapse:collapse">
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
      <!-- Not nowrap: the badge holds itself on one line, but the coverage note beside it
           ("(20/20 rated)", "(not in this template)") is prose and must be allowed onto a second
           line. Under table-layout:fixed a nowrap cell does not widen its column, it is clipped —
           seen in a rendered PDF as a Rating column reading "(not in this te". -->
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;text-align:right">${rating}</td>
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
            statusContradictsSeverity(f.status, f.severity)
              ? // Named here too, not only on the detail row: this panel sits on the page some
                // readers are the only ones to open, and a Red entry whose own note reads benign
                // ("Expires 2029-04-01 (925 days out)") is unexplainable without it.
                `<span style="font-weight:400;font-size:11.5px;color:${MUTED_TEXT}"> — recorded status: ${escapeHtml(STATUS_LABEL[f.status] ?? f.status)}, which disagrees with this rating</span>`
              : ""
          }${
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
          <th style="width:12%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Tier</th>
          <th style="width:41%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">What it covers</th>
          <th style="width:21%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap">${SEVERITY_GLYPH.RED} / ${SEVERITY_GLYPH.YELLOW} / ${SEVERITY_GLYPH.GREEN}</th>
          <th style="width:26%;text-align:right;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Rating</th>
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

// ---------------------------------------------------------------------------
// Structured findings (spec.md §4 Tier B: "turn 'here's a PDF contract' into a structured,
// comparable finding ... rather than just storing an attachment")
// ---------------------------------------------------------------------------

/**
 * Template v1/v2's entire structured model: three fixed keys, written by the pre-v3 audit form onto
 * findings whose item title matched a `/contract/i` regex. v3 replaced this with per-item declared
 * schemas (src/lib/templates/fieldSchema.ts), but a Report is a historical document and an Audit
 * stays pinned to the Template version it started on (spec.md §5) — so findings in this shape are
 * still rendered today, from a template row that has no `fieldSchema` to read labels from.
 *
 * The labels are hardcoded here because there is nowhere else to get them; the values are printed
 * verbatim because v1/v2 captured them as free text ("$4,800", "3 months' fees") and never
 * canonicalised them — running them through the money formatter would invent precision the data
 * does not have.
 */
const LEGACY_STRUCTURED_FIELDS: { key: string; label: string }[] = [
  { key: "transferable", label: "Transfers to the buyer" },
  { key: "penaltyAmount", label: "Early-termination penalty" },
  { key: "penaltyBasis", label: "Penalty basis" },
];

/**
 * Above this many rows in a single structured table, the finding's row in the tier table is allowed
 * to break across pages (see PRINT_STYLES' `tr.allow-break`). Chosen so a table that plausibly fits
 * beside its finding still travels with it, while the 5-15-row inventories stop forcing an
 * unsatisfiable keep-together.
 */
const KEEP_TOGETHER_MAX_TABLE_ROWS = 6;

/** One label/value pair, ready for `definitionList`. */
interface RenderedField {
  label: string;
  /** Already-escaped HTML. */
  html: string;
}

/**
 * The three shapes `Finding.structuredData` can hold, resolved explicitly rather than by accident —
 * each one is a different era of the product and they coexist in live data:
 *
 *  1. SCHEMA-DRIVEN (template v3+, manual items). The item declares `fieldSchema` and the values are
 *     keyed by it. Rendered from the declared labels/kinds, money and percent formatted through
 *     `formatFieldValue` so "12000" prints as $12,000.00.
 *  2. LEGACY (template v1/v2 items). No `fieldSchema` on the item; the three keys above. Still
 *     rendered — a Report generated from an old audit must not silently lose content it used to
 *     show (spec.md §5/§6).
 *  3. TIER A AUTOMATED OUTPUT. No `fieldSchema` either, but the JSON here is a check runner's raw
 *     result object (src/lib/audit/tierA.ts writes e.g. `{registrar, expiryDate, nameservers}`).
 *     It has none of the legacy keys, so it falls through both paths above and renders NOTHING —
 *     which is the behaviour before this change, and the right one: the finding's note already
 *     states what the check observed, in a sentence a buyer can read. Never dump this JSON.
 *
 * The method guard mirrors the audit form's (src/app/(app)/.../page.tsx): `structuredData` doubles
 * as the automated runner's output store, so a schema is honoured on manual items only.
 */
/**
 * The citation line under a value: where it was read from, and the words themselves.
 *
 * Rendered as part of the value rather than as a footnote, because a reader deciding whether to
 * trust "Transferable: No" should not have to look anywhere else to see the clause behind it.
 */
function citationHtml(citations: ResolvedCitation[] | undefined): string {
  if (!citations || citations.length === 0) return "";
  return citations
    .map(
      (citation) =>
        `<div style="font-size:11px;color:${NEUTRAL_TEXT};margin-top:2px">${escapeHtml(formatCitation(citation))}</div>`,
    )
    .join("");
}

function structuredFields(f: ReportFinding, accent: string): string {
  const schema =
    f.templateItem.method === CheckMethod.AUTOMATED ? null : parseFieldSchema(f.templateItem.fieldSchema);

  // Path 1.
  if (schema) return schemaDrivenFields(schema, f.structuredData, accent, f.citations);

  // Paths 2 and 3.
  return legacyStructuredFields(f.structuredData);
}

/** Path 1: values keyed by the item's own declared schema. */
function schemaDrivenFields(
  schema: ItemFieldSchema,
  raw: unknown,
  accent: string,
  citations?: Map<string, ResolvedCitation[]>,
): string {
  const values = readPersistedValues(schema, raw);
  if (!hasAnyFieldValue(values)) return "";

  const scalars: RenderedField[] = [];
  const tables: string[] = [];

  // Schema declaration order, not object-key order: the schema is how the consultant was asked for
  // these facts, and a buyer reading the item should meet them in the same sequence.
  for (const field of schema.fields) {
    const value = values[field.key];
    // A field the consultant left blank is absent from `values` (readPersistedValues drops empties)
    // and must not print as an empty row.
    if (value === undefined) continue;

    if (field.kind === "table") {
      if (Array.isArray(value) && value.length > 0) tables.push(fieldTable(field, value, accent));
      continue;
    }
    const formatted = formatFieldValue(field, value);
    if (formatted.trim() === "") continue;
    scalars.push({
      label: field.label,
      html:
        (field.kind === "longtext"
          ? // Preserve the consultant's own paragraphing in a quoted clause or an observation;
            // everything else is a single short value.
            `<span style="white-space:pre-line">${escapeHtml(formatted)}</span>`
          : escapeHtml(formatted)) + citationHtml(citations?.get(field.key)),
    });
  }

  return `${definitionList(scalars)}${tables.join("")}`;
}

/** Paths 2 and 3: no declared schema. Legacy keys render; anything else (Tier A output) does not. */
function legacyStructuredFields(raw: unknown): string {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return "";
  const source = raw as Record<string, unknown>;

  const fields: RenderedField[] = [];
  for (const { key, label } of LEGACY_STRUCTURED_FIELDS) {
    const value = source[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    fields.push({ label, html: escapeHtml(value) });
  }
  return definitionList(fields);
}

/**
 * The labelled definition list both paths render scalars into. Previously these were joined into a
 * single grey run-on line ("Transferable: yes · Penalty: 4800 · Basis: …"), which put the label and
 * the value in the same weight and colour and stopped being readable at more than three fields —
 * v3 items declare up to eight.
 *
 * A two-column table rather than a `<dl>`: the print rules that keep a label with its value
 * (`tr { break-inside: avoid }`) and repeat headers across pages are table rules, and this file's
 * whole layout convention is inline-styled tables for exactly that reason.
 */
function definitionList(fields: RenderedField[]): string {
  if (fields.length === 0) return "";
  const rows = fields
    .map(
      (f) => `
              <tr>
                <th scope="row" style="text-align:left;padding:3px 12px 3px 0;font-size:11.5px;font-weight:600;color:${MUTED_TEXT};vertical-align:top;width:38%">${escapeHtml(f.label)}</th>
                <td style="padding:3px 0;font-size:12.5px;color:#334155;vertical-align:top">${f.html}</td>
              </tr>`,
    )
    .join("");
  return `
            <table style="width:100%;border-collapse:collapse;margin-top:6px">
              <tbody>${rows}</tbody>
            </table>`;
}

/**
 * A `table`-kind field: the consultant's rows under the column labels the schema declares.
 *
 * The recurring-SaaS inventory (spec.md §4: "structured table the consultant fills from
 * seller-provided list") is the reason this exists, and it routinely runs 5-15 rows — long enough
 * to cross a page boundary, which is why the header is a real `<thead>` (repeated on each page by
 * PRINT_STYLES' `display: table-header-group`, so a continued table is never a grid of unlabelled
 * values) and every body row carries the avoid-break rule.
 */
function fieldTable(field: FieldDef, rows: Record<string, string>[], accent: string): string {
  const columns = field.columns ?? [];
  if (columns.length === 0) return "";

  // Numbers right-align so a column of costs can be read down as a column of costs.
  const align = (c: ColumnDef): string => (c.kind === "money" || c.kind === "percent" ? "right" : "left");
  // Atomic values — an amount or an ISO date — are never worth breaking across two lines; seen in a
  // rendered PDF as a term-end column reading "2027-02-" / "28". Free text still wraps.
  const atomic = (c: ColumnDef): boolean => c.kind === "money" || c.kind === "percent" || c.kind === "date";
  const wrap = (c: ColumnDef): string => (atomic(c) ? "white-space:nowrap;" : "");

  // Declared column widths, because PRINT_STYLES puts every table in `table-layout: fixed` and fixed
  // layout reads widths from the first row only. Atomic columns need just enough for an amount or an
  // ISO date and are given half the share of a free-text column, which is where the long values
  // actually are.
  const weight = (c: ColumnDef): number => (atomic(c) || c.kind === "boolean" ? 1 : 2);
  const totalWeight = columns.reduce((sum, c) => sum + weight(c), 0);
  const width = (c: ColumnDef): string => `${((weight(c) / totalWeight) * 100).toFixed(2)}%`;

  const head = columns
    .map(
      // No `white-space: nowrap` on the header: a column labelled "Account owner of record at the
      // seller organisation" is a schema-declared string of any length, and holding it on one line
      // was half of what pushed this table off the paper. It wraps instead.
      (c) => `
                <th style="width:${width(c)};text-align:${align(c)};padding:4px 8px;font-size:10.5px;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;color:${NEUTRAL_TEXT};border-bottom:1px solid #cbd5e1">${escapeHtml(c.label)}</th>`,
    )
    .join("");

  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const raw = row[c.key];
          // An empty cell in an otherwise-filled row is a real, meaningful blank — the consultant
          // did not know. It prints as a blank cell, not as a dropped column.
          const value =
            raw === undefined || raw === "" ? "" : escapeHtml(formatFieldValue(columnAsField(c), raw));
          return `<td style="text-align:${align(c)};${wrap(c)}padding:4px 8px;font-size:11.5px;color:#334155;border-bottom:1px solid #e2e8f0;vertical-align:top">${value}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
            <div style="margin-top:8px">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${MUTED_TEXT};font-weight:600">${escapeHtml(field.label)}</div>
              <table style="width:100%;border-collapse:collapse;margin-top:4px;border:1px solid #cbd5e1">
                <thead><tr style="background:${accentWash(accent, 0.07)}">${head}</tr></thead>
                <tbody>${body}</tbody>
              </table>
            </div>`;
}

/** A table column is a scalar field in everything but name — formatted by the same rules, so a
 * money column prints like a money field rather than as a bare "12000". */
function columnAsField(column: ColumnDef): FieldDef {
  return { key: column.key, label: column.label, kind: column.kind, options: column.options };
}

/** Total rows across every table field a finding will render — decides whether the finding's row in
 * the tier table can still be kept on one page. */
function structuredTableRowCount(f: ReportFinding): number {
  if (f.templateItem.method === CheckMethod.AUTOMATED) return 0;
  const schema = parseFieldSchema(f.templateItem.fieldSchema);
  if (!schema) return 0;
  const values = readPersistedValues(schema, f.structuredData);
  return schema.fields.reduce((total, field) => {
    const value = values[field.key];
    return field.kind === "table" && Array.isArray(value) ? total + value.length : total;
  }, 0);
}

function findingRow(f: ReportFinding, accent: string): string {
  const structuredBlock = structuredFields(f, accent);

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

  // See statusContradictsSeverity: both values are shown and the disagreement is named, rather than
  // printing "Pass" next to a Red badge and leaving the reader to work out which one to believe.
  const contradiction = !suppressSeverity && statusContradictsSeverity(f.status, f.severity);

  // The severity rail: a second, positional encoding of severity that survives greyscale printing
  // and sits on the same row as the title, so a scanning reader finds the bad rows without reading
  // the right-hand column at all.
  const rail = severity ? SEVERITY_COLOR[severity] : "#cbd5e1";

  // Only the description is client-facing (see the ReportFinding docstring): guidance and
  // severityGuidance are internal methodology and are not even carried on this type.
  const rowClass = structuredTableRowCount(f) > KEEP_TOGETHER_MAX_TABLE_ROWS ? "allow-break" : "keep-together";

  return `
        <tr class="${rowClass}" style="border-bottom:1px solid #e2e8f0">
          <td style="padding:9px 12px;vertical-align:top;width:72%;border-left:4px solid ${rail}">
            <div style="font-weight:600">${escapeHtml(f.templateItem.title)}</div>
            ${f.templateItem.description ? `<div style="color:${NEUTRAL_TEXT};font-size:12.5px;margin-top:2px">${escapeHtml(f.templateItem.description)}</div>` : ""}
            ${f.note ? `<div style="margin-top:6px;font-size:12.5px;color:#334155"><em>Finding:</em> ${escapeHtml(f.note)}</div>` : ""}
            ${structuredBlock}
            ${f.evidenceCount ? `<div style="margin-top:4px;font-size:12px;color:#0369a1">${f.evidenceCount} document${f.evidenceCount === 1 ? "" : "s"} attached</div>` : ""}
          </td>
          <td style="padding:9px 12px;text-align:right;vertical-align:top">
            <div style="font-size:11.5px;color:${MUTED_TEXT};margin-bottom:4px;white-space:nowrap">${escapeHtml(STATUS_LABEL[f.status] ?? f.status)}</div>
            ${severity ? badge(severity) : neutralBadge(suppressSeverity ? "Not applicable" : "Not rated")}
            ${
              contradiction
                ? `<div style="margin-top:5px;font-size:10.5px;line-height:1.45;color:${NEUTRAL_TEXT};font-weight:600;text-align:right">Recorded status and rating disagree. The rating shown is the one this report&#39;s roll-up used.</div>`
                : ""
            }
          </td>
        </tr>`;
}

/**
 * The appendix: what documents this audit was built on, listed rather than reproduced.
 *
 * spec.md §6 used to read "appendix (raw uploaded documents, if the consultant opts to include
 * them)"; the decision recorded there now matches what this has always done, and lists them. Embedding a seller's executed contracts and
 * merchant statements into a PDF the buyer can forward anywhere is a confidentiality decision
 * nobody made, it would multiply the deliverable's size, and the documents are already retained
 * and access-controlled under the firm's retention policy. A buyer who needs a specific document
 * asks the consultant for it, which is the same way every other diligence work product handles it.
 *
 * What makes a listing defensible rather than decorative is that each entry can be checked: what
 * the document was, how large, who attached it and when. A bare filename gives a buyer's advisor
 * nothing to verify against, which is the bar spec.md §2.1 sets for anything reaching the client.
 * Rows predating provenance capture degrade to what is known rather than printing unknowns.
 */
function appendixSection(
  documents: AppendixDocument[] | undefined,
  accent: string,
  accentText: string,
): string {
  if (!documents || documents.length === 0) return "";

  const rows = documents
    .map((d) => {
      const descriptors = [
        d.mimeType ? describeMimeType(d.mimeType) : null,
        d.sizeBytes != null ? formatFileSize(d.sizeBytes) : null,
      ].filter(Boolean);
      // The date is wrapped in its own nowrap span rather than the whole cell being nowrap: an
      // attributor's name is free text and must be allowed to break, but an ISO date splitting as
      // "2026-09-" / "14" is the same defect the table cells guard against.
      const attachedOn = `<span style="white-space:nowrap">${escapeHtml(d.attachedAt.toISOString().slice(0, 10))}</span>`;
      const provenance = d.attributedTo ? `${escapeHtml(d.attributedTo)}, ${attachedOn}` : attachedOn;

      return `
    <tr class="keep-together" style="border-bottom:1px solid #e2e8f0">
      <td style="padding:6px 12px;font-size:12.5px">
        ${escapeHtml(d.label ?? d.filename)}
        ${d.label ? `<div style="font-size:11px;color:${NEUTRAL_TEXT}">${escapeHtml(d.filename)}</div>` : ""}
      </td>
      <td style="padding:6px 12px;font-size:12px;color:${NEUTRAL_TEXT};white-space:nowrap">${escapeHtml(descriptors.join(" · "))}</td>
      <td style="padding:6px 12px;font-size:12px;color:${NEUTRAL_TEXT}">${escapeHtml(d.findingTitle)}</td>
      <td style="padding:6px 12px;font-size:12px;color:${NEUTRAL_TEXT};white-space:nowrap">Tier ${d.tier}</td>
      <td style="padding:6px 12px;font-size:12px;color:${NEUTRAL_TEXT}">${provenance}</td>
    </tr>`;
    })
    .join("");

  return `
  <section style="margin-top:26px">
    <h3 style="font-size:16px;margin:0 0 10px 0;padding-left:10px;border-left:4px solid ${accent}">Appendix — Documents relied on</h3>
    <p style="font-size:12px;color:${NEUTRAL_TEXT};margin:0 0 10px 0">Documents provided as evidence during this audit, listed for reference. They are retained and access-controlled under the firm's document retention policy and are not reproduced here; the firm can provide any of them on request.</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1">
      <thead>
        <tr style="background:${accent};color:${accentText}">
          <th style="width:30%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Document</th>
          <th style="width:15%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Type</th>
          <th style="width:24%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Evidence for</th>
          <th style="width:9%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Tier</th>
          <th style="width:22%;text-align:left;padding:6px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Provided by</th>
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
