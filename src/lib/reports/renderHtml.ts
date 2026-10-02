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
import { appendixRetentionSentence } from "@/lib/retention/policy";

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
  /**
   * When this engagement's documents are scheduled for deletion, so the appendix can say so rather
   * than promising availability with no end. Null means no purge is scheduled — a live deal.
   */
  documentPurgeAt?: Date | null;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  [Severity.GREEN]: "Green",
  [Severity.YELLOW]: "Yellow",
  [Severity.RED]: "Red",
};

/**
 * The validated severity palette (.claude/skills/consultant-ux-design/SKILL.md, which defers the
 * colour methodology to `dataviz`). These four hues are the product's, not this file's: do not
 * invent a new severity colour here and do not re-tune these to taste. Each clears 4.5:1 against
 * white for the glyph-on-paper case and carries white text at 5:1 or better inside a badge, which
 * is what lets the same hex serve as both a text colour and a fill.
 */
const SEVERITY_COLOR: Record<Severity, string> = {
  [Severity.GREEN]: "#067647",
  [Severity.YELLOW]: "#b54708",
  [Severity.RED]: "#b42318",
};

/** The fourth member of that palette: the "nothing rated here" mark, used wherever a severity
 * colour would be if there were one. A grey with a trace of blue in it, so a row of glyphs reads as
 * one family rather than as three colours and a smudge. */
const SEVERITY_NEUTRAL = "#6b7589";

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

/**
 * Tier identity, matching the app's own tier colours so a consultant reading the audit screen and a
 * buyer reading the PDF are looking at the same three things.
 *
 * Deliberately used ONLY as a type colour on the words "Tier A"/"Tier B"/"Tier C" themselves — never
 * as a fill, a band or a rule. Two reasons, both product decisions rather than taste. First, the
 * firm's accent is the document's only structural colour (spec.md §6 whitelabel): a tier-coloured
 * band would be a second brand competing with the consultant's. Second, Tier B's amber is the same
 * hue as Yellow severity, so anything larger than a word of it starts reading as a rating.
 */
const TIER_COLOR: Record<Tier, string> = { A: "#1f47dc", B: "#b54708", C: "#6938ef" };

/**
 * The tier label, split at the point where its own prefix ends, so "Tier A" can carry the tier
 * colour and the rest of the sentence cannot. Concatenated this is byte-for-byte TIER_LABEL — the
 * label is client-facing text and nothing here may reword it.
 */
function tierHeadingHtml(tier: Tier): string {
  const prefix = TIER_SHORT[tier];
  const rest = TIER_LABEL[tier].slice(prefix.length);
  return `<span style="color:${TIER_COLOR[tier]}">${escapeHtml(prefix)}</span>${escapeHtml(rest)}`;
}

// ---------------------------------------------------------------------------
// The document's print scale
//
// One scale, declared once, rather than a size and a margin chosen per block. A diligence
// deliverable is read beside a QoE report and a legal memo, and what makes those documents look
// competent is not any individual choice but the fact that the same four or five measurements
// recur on every page.
//
// TYPE. A4 at 14mm side margins gives a 688px measure, which at 12.5px body type is ~95 characters
// a line — slightly wide, so the leading is correspondingly generous (1.55) to keep the eye's
// return accurate. Every size below is a step on that scale; nothing in this file should introduce
// a size between two of them.
//
// SPACE. A 4px unit, used in multiples. The rhythm that matters in print is the one BETWEEN blocks,
// so the gaps are the scale's coarse end (8/12/16/24/32) and the padding inside a block its fine
// end (4/6/8/12).
// ---------------------------------------------------------------------------
const TYPE = {
  /** The business name on the cover, and nothing else. */
  coverTitle: 34,
  /** "Executive summary". */
  section: 17,
  /** A tier heading, the appendix heading. */
  subsection: 14.5,
  /** A finding title, a cover fact value. */
  lead: 13,
  /** Running body text. */
  body: 12.5,
  /** Supporting prose: a finding's description, a table cell, the disclaimer. */
  support: 11.5,
  /** Column heads, eyebrows, provenance lines. */
  micro: 10.5,
  /** Table column labels, the smallest thing on the page that is still meant to be read. */
  label: 10,
} as const;

const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Hairlines. Print rules should separate, not enclose: a 1px rule two steps lighter than the text
 * it divides reads as structure, and a 1px rule at full strength reads as a box. */
const RULE = "#dfe4ea";
const RULE_STRONG = "#c3cbd6";

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
 * How far an accent is from being a grey: the spread between its strongest and weakest sRGB
 * channel, 0 for any grey (white included) and 1 for a fully saturated primary.
 *
 * Deliberately the raw channel spread rather than HSL saturation, which is useless here — HSL
 * calls the pale wash #fff3c4 "100% saturated" and it is plainly a tint of the paper.
 */
function chroma(hex: string): number {
  const normalized = normalizeAccentColor(hex);
  const channels = [1, 3, 5].map((start) => parseInt(normalized.slice(start, start + 2), 16));
  return (Math.max(...channels) - Math.min(...channels)) / 255;
}

/**
 * The floor above which an accent is a colour rather than a shade of the paper.
 *
 * Calibrated against real firm brand colours rather than picked: the least saturated brand in a
 * 24-colour sample of accounting/consulting/tech brands is Shopify's #95bf47 at 0.47, and the
 * palest thing that has to be caught is the #fff3c4 wash at 0.23. 0.35 sits between them with room
 * on both sides. Greys are at or near 0 (#e2e8f0 is 0.05), so the white-branded firm this whole
 * clamp exists for is nowhere near it.
 */
const MIN_BRAND_CHROMA = 0.35;

/**
 * The accent, left exactly as the firm chose it unless it is indistinguishable from the paper.
 *
 * Observed in a rendered PDF: an org whose brandColorHex is "#ffffff" got a document with no
 * structure at all — the cover band, every section rule, every table-header fill and the running
 * header/footer rules were white on white. Text stayed legible (readableTextOn flips correctly), so
 * nothing looked broken; the deliverable had simply lost every visual boundary a reader navigates
 * by, with no error anywhere to say so.
 *
 * WHY THIS IS NOT SIMPLY WCAG 1.4.11. The first fix for that used the standard's non-text contrast
 * bar, 3:1 against the page, and claimed in this docstring that every normal brand accent came back
 * byte-identical. Measured against 24 real brand hexes, six did not: EY's #ffe600 came back
 * #a69600, Deloitte's #86bc25 came back #74a220, and Cloudflare, HubSpot, Shopify and Salesforce
 * were all shifted too. A rendered cover at #ffe600 was olive-gold throughout. That is not an edge
 * case — saturated yellow, orange and lime cannot clear 3:1 against white at any usable lightness,
 * so the rule was silently restyling a whole category of real firms' brands.
 *
 * Weighed against spec.md §2 principle 4 ("whitelabel by default — the consultant's brand is on the
 * report"), that is the wrong trade, and the reason is that the contrast ratio is the wrong
 * instrument. WCAG's formula is luminance-only by design; it cannot tell #ffe600 (1.27:1) from
 * #e2e8f0 (1.25:1), and on paper those two are not remotely alike. A saturated yellow rule on white
 * is visible because it is YELLOW; a pale grey rule is invisible because it differs from the paper
 * in nothing but a little lightness. So the test here is chroma first: an accent with real colour in
 * it is the firm's decision and is used verbatim, however bright. Only a near-grey — which has
 * nothing but luminance to be seen by, and for which WCAG's ratio is therefore exactly the right
 * instrument — is darkened, and then only by scaling its sRGB channels, which holds the hue: a pale
 * gold firm gets a deeper gold, a white firm gets a neutral grey, because grey is what white
 * actually is once it has to be visible.
 *
 * WHAT THE FIRM GIVES UP by choosing a bright accent is that its rules and bands are faint in
 * greyscale. That costs the reader nothing: the accent carries no information in this document.
 * Severity — the one thing that does — is encoded in a glyph, a word and a colour independently
 * (see SEVERITY_GLYPH), and section structure is carried by headings. The brand is decoration, and
 * decoration is the consultant's to choose.
 *
 * Deliberately NOT applied to accent-colored *text*, which needs the stricter 4.5:1 and gets
 * `pageTextAccent` instead — a line of #ffe600 text is genuinely unreadable, chroma or no chroma,
 * because a glyph's strokes are thin enough that only luminance separates them from the page.
 */
export function structuralAccent(hex: string): string {
  const normalized = normalizeAccentColor(hex);
  if (chroma(normalized) >= MIN_BRAND_CHROMA) return normalized;
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

/**
 * A severity chip. Rectangular with a 3px radius rather than a full pill: a pill is the house style
 * of a product dashboard, and this document is read beside a QoE report and a legal memo. The
 * geometry is the only thing that changed — glyph, word and colour are the three encodings
 * SEVERITY_GLYPH's note requires and all three are still here.
 *
 * Widths are load-bearing, not cosmetic: the chip sits in the tier table's fixed 150px status
 * column (STATUS_COLUMN_PX), so its padding and type size cannot grow without re-measuring that.
 */
function badge(severity: Severity, size: "sm" | "md" = "sm"): string {
  const pad = size === "md" ? "5px 13px" : "2px 9px";
  const font = size === "md" ? 14.5 : 12;
  return `<span style="display:inline-block;padding:${pad};border-radius:3px;font-size:${font}px;line-height:1.35;font-weight:600;letter-spacing:0.01em;color:#fff;background:${SEVERITY_COLOR[severity]};white-space:nowrap"><span style="font-size:${size === "md" ? 13 : 11}px;vertical-align:1px">${SEVERITY_GLYPH[severity]}</span> ${SEVERITY_LABEL[severity]}</span>`;
}

/** The same chip for the two "nothing to rate here" states: outlined rather than filled, so a
 * reader scanning for solid colour never stops on one by mistake. */
function neutralBadge(label: string): string {
  return `<span style="display:inline-block;padding:1px 8px;border:1px solid ${RULE_STRONG};border-radius:3px;font-size:12px;line-height:1.35;font-weight:600;color:${SEVERITY_NEUTRAL};background:#f6f7f9;white-space:nowrap"><span style="font-size:11px;vertical-align:1px">${UNRATED_GLYPH}</span> ${escapeHtml(label)}</span>`;
}

/**
 * A severity badge is a claim that something was checked. Found via UI testing (not caught by unit
 * tests, which only exercised the pure rollup math): a brand-new audit with zero rated findings
 * rendered "Overall: Green" with no indication nothing had been checked — reading as "verified
 * safe" rather than "not started." Never render `badge(rollup.overall)` or `badge(rollup.perTier[x])`
 * directly in this file again without checking coverage.rated first.
 */
function badgeWithCoverage(severity: Severity, coverage: Coverage, size: "sm" | "md" = "sm"): string {
  // Named in the deliverable, not only in the app. Tier A's automated checks write a status and a
  // severity together, so an audit can present ratings the consultant has not confirmed — and the
  // buyer is the one person who cannot tell the difference by looking. A count that says "of which
  // N awaiting confirmation" costs a clause and keeps the number from overstating the work.
  const awaiting =
    coverage.provisional > 0
      ? `, ${coverage.provisional} awaiting confirmation`
      : "";
  // Set at body size beside the overall rating rather than as fine print. A green rating on an
  // unrated audit must never read as "verified safe" (spec.md §6 coverage honesty), and a coverage
  // figure typeset two steps smaller than the badge it qualifies is a coverage figure a
  // time-pressured reader does not read. Beside a per-tier badge it stays supporting type: the
  // overall line is the one that carries the claim.
  const coverageNote =
    size === "md"
      ? `<span style="color:${NEUTRAL_TEXT};font-size:${TYPE.body}px;font-weight:500;white-space:nowrap"> (${coverage.rated}/${coverage.total} rated${awaiting})</span>`
      : `<span style="color:${MUTED_TEXT};font-size:11.5px;font-weight:400"> (${coverage.rated}/${coverage.total} rated${awaiting})</span>`;
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
 * WHAT FIXED LAYOUT COSTS, AND WHY THE COLUMNS ARE NOW MEASURED
 * ------------------------------------------------------------
 * An earlier version of this note claimed that a `white-space: nowrap` cell "cannot be touched by
 * this rule", and that atomic money/date cells were therefore safe. That was false, and the
 * opposite of safe. Fixed layout gives a column the width the first row declared and nothing else;
 * a nowrap cell wider than that does not clip and does not widen the column — it OVERFLOWS, drawn
 * on top of its neighbour. Observed in a rendered 6-column vendor register: `$419.00
 * $5,028.002027-02-2Assignment`, three columns painted over each other, all of them still in the
 * text layer and none of them readable.
 *
 * The declared widths are therefore no longer a share-out of arbitrary weights. `fieldTable` sizes
 * each atomic column from the widest value it actually has to print (see `computeFieldTableLayout`)
 * and steps the whole table's type down a size when a dense table cannot hold them all at full
 * size. `overflow-wrap: anywhere` is also switched OFF on those cells and on every column header —
 * it is what was breaking labels mid-word into `MONT`/`HLY COST` — so they break only at the
 * explicit `<wbr>` opportunities between a money value's thousands groups and a date's hyphens,
 * which only come into play when a table is dense enough that even the smallest step does not fit.
 * Free text is the only thing that still breaks anywhere, which is the case this rule exists for.
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

  /* Print orphan/widow control. Chromium's default is 2, which permits a single line of a
     scope paragraph or a finding note to sit alone at the top or foot of a page — the thing that
     most reliably makes a long document look like a web page someone printed. */
  p, li, td, th, div { orphans: 3; widows: 3; }

  /* A heading must never be the last thing on a page, and the rule above it must not be either:
     "break-after: avoid" on the heading is not enough on its own, because the heading's own
     introductory block (the tier badge line) can take the break instead. */
  .section-head { break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }

  /* Lining figures wherever a reader compares numbers down a column rather than reading them in a
     sentence. Deliberately NOT applied to the structured field tables: their column widths are
     computed from a per-character width estimate (charWidthEm) measured against the proportional
     figures the system stack actually renders, and changing the figure set under that estimate is
     how a measured column stops being wide enough for its own value. */
  .tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

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
  // structuralAccent once, here. For every accent with any real colour in it — and for every grey
  // dark enough to see — that is the identity function and the whitelabel treatment is
  // byte-for-byte unchanged; it only bites on an accent that is a tint of the paper itself, where
  // the structure it draws would not exist at all. See structuralAccent.
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
      <section style="margin-top:${SPACE.xl + 2}px">
        <!-- Heading and its rating line are one unit for pagination: a tier heading stranded at the
             foot of a page, with its own rating at the top of the next, is the break this document
             can least afford. "break-after: avoid" on the h3 alone does not achieve it — the gap
             between the heading and the badge beneath it is a legal break point. -->
        <div class="section-head" style="margin:0 0 ${SPACE.md}px 0;padding-left:${SPACE.md}px;border-left:3px solid ${accent}">
          <h3 style="font-size:${TYPE.subsection}px;font-weight:700;letter-spacing:-0.005em;line-height:1.35;margin:0">${tierHeadingHtml(tier)}</h3>
          <div style="margin-top:${SPACE.sm - 2}px">${badgeWithCoverage(rollup.perTier[tier], rollup.perTierCoverage[tier])}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid ${RULE}">
          <thead>
            <tr style="background:${accent};color:${accentText}">
              <th style="text-align:left;padding:7px 12px;font-size:${TYPE.label}px;letter-spacing:0.09em;text-transform:uppercase;font-weight:700">${escapeHtml(TIER_SHORT[tier])} finding</th>
              <!-- A fixed ${STATUS_COLUMN_PX}px rather than the previous 28%: the status column holds a status
                   word and a badge and never needs more, while the finding column holds the
                   structured registers, which were being laid out in 466px of a 688px page and
                   breaking their own column labels for want of the 100px sitting empty beside
                   them. Fixed layout gives the declared width to this column and the remainder to
                   the one left auto. See FIELD_TABLE_WIDTH_PX. -->
              <th style="width:${STATUS_COLUMN_PX}px;text-align:right;padding:7px 12px;font-size:${TYPE.label}px;letter-spacing:0.09em;text-transform:uppercase;font-weight:700;white-space:nowrap">Status &amp; rating</th>
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
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#0f172a; margin:0; padding:0; font-size:${TYPE.body}px; line-height:1.55; text-rendering:optimizeLegibility">
${pdfHeaderTemplate(data, accent, logo)}
${pdfFooterTemplate(data, accent)}
${coverPage(data, accent, accentText, logo, rollup.overall, rollup.overallCoverage)}
${executiveSummary(data, accent, accentText, rollup, counts, overrideBlock)}
${tierSections}
${appendixSection(data.appendixDocuments, accent, accentText, appendixRetentionSentence(data.documentPurgeAt ?? null))}
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
  // A fact block, not a layout table: a hairline above each row and a label column of fixed width
  // give the four facts a single left edge and a single value edge, which is what makes a reader
  // take them as the document's particulars rather than as the start of its content. The value is
  // `tnum` so the two dates align digit for digit under each other.
  const metaRow = (label: string, value: string): string => `
    <tr>
      <td style="padding:${SPACE.sm}px ${SPACE.lg}px ${SPACE.sm}px 0;font-size:${TYPE.micro}px;font-weight:600;color:${MUTED_TEXT};text-transform:uppercase;letter-spacing:0.1em;white-space:nowrap;vertical-align:top;width:180px;border-top:1px solid ${RULE}">${escapeHtml(label)}</td>
      <td class="tnum" style="padding:${SPACE.sm}px 0;font-size:${TYPE.lead}px;color:#0f172a;vertical-align:top;border-top:1px solid ${RULE}">${escapeHtml(value)}</td>
    </tr>`;

  return `
  <section class="page-break-after" style="min-height:235mm;padding:4mm 0 0 0;display:flex;flex-direction:column">
    <!-- MASTHEAD. The firm's identity is the first thing on the page and the largest thing above
         the title, and the rule under it is the firm's accent at full strength. spec.md §6's
         whitelabel rule is not a credit line at the bottom — it is who the document appears to be
         from, which on a cover is decided in the top 40mm. -->
    <div style="flex:0 0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:${SPACE.xl}px">
        <div>
          <div style="font-size:${TYPE.micro}px;font-weight:600;text-transform:uppercase;letter-spacing:0.16em;color:${MUTED_TEXT}">Prepared by</div>
          <div style="font-weight:700;font-size:21px;letter-spacing:-0.005em;line-height:1.25;margin-top:${SPACE.xs + 1}px">${escapeHtml(data.org.name)}</div>
        </div>
        ${logo ? `<img src="${escapeAttr(logo)}" alt="${escapeAttr(data.org.name)} logo" style="max-height:66px;max-width:230px;object-fit:contain" />` : ""}
      </div>
      <!-- A thick rule in the firm's accent over a hairline: the oldest trick in document design for
           making a masthead read as a masthead, and the one place the brand colour is allowed to be
           the loudest thing on the page. -->
      <div style="height:5px;background:${accent};margin-top:${SPACE.lg}px"></div>
      <div style="height:1px;background:${RULE};margin-top:2px"></div>
    </div>

    <div style="flex:1 1 auto;padding-top:${SPACE.xxl + SPACE.lg}px">
      <div style="font-size:11.5px;text-transform:uppercase;letter-spacing:0.2em;color:${accent === DEFAULT_ACCENT ? MUTED_TEXT : pageTextAccent(accent)};font-weight:700">Technology Due-Diligence Report</div>
      <h1 style="margin:${SPACE.md}px 0 0 0;font-size:${TYPE.coverTitle}px;font-weight:700;line-height:1.12;letter-spacing:-0.018em;max-width:16em">${escapeHtml(data.businessName)}</h1>

      <div class="keep-together" style="margin-top:${SPACE.xl + SPACE.xs}px;display:inline-block;padding:${SPACE.md}px ${SPACE.xl}px ${SPACE.md + 2}px;border-left:4px solid ${accent};background:${accentWash(accent, 0.06)}">
        <div style="font-size:${TYPE.micro}px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:${MUTED_TEXT}">Overall rating (computed from the findings)</div>
        <div style="margin-top:${SPACE.sm}px">${badgeWithCoverage(overall, coverage, "md")}</div>
        ${
          data.overallRatingOverride
            ? // spec.md §6: an override is never a substitution. On the cover that means the computed
              // rating above stays exactly where it is and the override is stated beneath it, with a
              // pointer to the reasoning rather than a restatement of it.
              `<div style="margin-top:${SPACE.md}px;padding-top:${SPACE.sm + 2}px;border-top:1px solid ${RULE_STRONG};font-size:${TYPE.support}px;color:${NEUTRAL_TEXT}">Consultant override: ${badge(data.overallRatingOverride)} <span style="color:${MUTED_TEXT}">— see the executive summary for the consultant's reasoning.</span></div>`
            : ""
        }
      </div>

      <!-- A rule above every row and one under the last of them, so the block is closed at both
           ends; an open-ended list of facts reads as the start of the document's content rather
           than as its particulars. -->
      <table class="keep-together" style="width:100%;max-width:520px;margin-top:${SPACE.xxl + SPACE.sm}px;border-collapse:collapse;border-bottom:1px solid ${RULE}">
        <tbody>
          ${data.engagementDate ? metaRow("Engagement date", formatDate(data.engagementDate)) : ""}
          ${data.dealStage ? metaRow("Deal stage", data.dealStage) : ""}
          ${metaRow("Audit template", data.templateName)}
          ${metaRow("Report generated", formatDate(data.generatedAt))}
        </tbody>
      </table>
    </div>

    <!-- Legal content (spec.md §6): placement and prominence are design decisions, the sentences are
         not. Set at support size on a tinted ground at the foot of the cover — the position a
         professional-services deliverable puts its basis-of-preparation note in, below the facts and
         above nothing. -->
    <div class="keep-together" style="flex:0 0 auto;margin-top:${SPACE.xxl}px;padding:${SPACE.md}px ${SPACE.lg}px ${SPACE.md + 2}px;border-top:2px solid ${accent};background:#f7f8fa">
      <div style="font-size:${TYPE.micro}px;text-transform:uppercase;letter-spacing:0.12em;color:${MUTED_TEXT};font-weight:700">Scope &amp; limitations</div>
      <p style="margin:${SPACE.sm}px 0 0 0;font-size:${TYPE.support}px;line-height:1.65;color:${NEUTRAL_TEXT};max-width:46em">${escapeHtml(REPORT_DISCLAIMER_TEXT)}</p>
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
  // Five tallies read as one instrument, so they are divided by hairlines rather than boxed
  // individually — five bordered boxes read as five separate things and make the eye stop four
  // times crossing a row it should take in at once. The figure is set large and in the severity's
  // own colour, with the glyph repeated beside the word beneath it so the row still works in
  // greyscale (SEVERITY_GLYPH's note).
  const countCell = (label: string, value: number, color: string, glyph: string, first = false): string => `
    <td style="padding:${SPACE.sm + 2}px ${SPACE.sm}px;text-align:center;width:20%;${first ? "" : `border-left:1px solid ${RULE_STRONG};`}vertical-align:top">
      <div class="tnum" style="font-size:26px;font-weight:700;color:${color};line-height:1.05;letter-spacing:-0.02em">${value}</div>
      <div style="margin-top:${SPACE.xs + 1}px;font-size:${TYPE.support}px;font-weight:600;color:${NEUTRAL_TEXT};white-space:nowrap"><span style="color:${color}">${glyph}</span> ${escapeHtml(label)}</div>
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
    const cell = `padding:${SPACE.sm + 1}px 12px;border-bottom:1px solid ${RULE};vertical-align:middle`;
    return `
    <tr>
      <td style="${cell};font-size:${TYPE.body}px;font-weight:700;color:${TIER_COLOR[tier]};white-space:nowrap">${escapeHtml(TIER_SHORT[tier])}</td>
      <td style="${cell};font-size:${TYPE.support}px;color:${NEUTRAL_TEXT}">${escapeHtml(TIER_LABEL[tier].replace(/^Tier [ABC] — /, ""))}</td>
      <td class="tnum" style="${cell};font-size:${TYPE.support}px;color:${NEUTRAL_TEXT};white-space:nowrap">${tierCounts.red} <span style="color:${SEVERITY_COLOR.RED}">${SEVERITY_GLYPH.RED}</span> · ${tierCounts.yellow} <span style="color:${SEVERITY_COLOR.YELLOW}">${SEVERITY_GLYPH.YELLOW}</span> · ${tierCounts.green} <span style="color:${SEVERITY_COLOR.GREEN}">${SEVERITY_GLYPH.GREEN}</span></td>
      <!-- Not nowrap: the badge holds itself on one line, but the coverage note beside it
           ("(20/20 rated)", "(not in this template)") is prose and must be allowed onto a second
           line. Under table-layout:fixed a nowrap cell does not widen its column, it is clipped —
           seen in a rendered PDF as a Rating column reading "(not in this te". -->
      <td style="${cell};text-align:right">${rating}</td>
    </tr>`;
  };

  const risks = topRiskFindings(data.findings);
  const totalRed = counts.red;
  const risksBlock =
    risks.length > 0
      ? `
    <div class="keep-together" style="margin-top:${SPACE.md + 2}px;padding-top:${SPACE.sm + 2}px;border-top:1px solid ${RULE_STRONG}">
      <div style="font-size:${TYPE.micro}px;text-transform:uppercase;letter-spacing:0.12em;color:${MUTED_TEXT};font-weight:700">What drove the rating — ${totalRed} Red ${totalRed === 1 ? "item" : "items"}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:${SPACE.sm}px">
        <tbody>
        ${risks
          .map(
            (f) => `
        <tr>
          <!-- 20px, not 18: under fixed layout the declared width is the whole width, and 18px
               less 10px of padding left the 13px severity glyph 8px of content box to sit in — so
               it overflowed into the tier label beside it by ~2px. Measured, not guessed. -->
          <td style="padding:${SPACE.sm - 1}px ${SPACE.sm}px ${SPACE.sm - 1}px 0;vertical-align:top;width:20px;color:${SEVERITY_COLOR.RED};font-size:${TYPE.lead}px;line-height:1.4">${SEVERITY_GLYPH.RED}</td>
          <td style="padding:${SPACE.sm - 1}px ${SPACE.sm}px ${SPACE.sm - 1}px 0;vertical-align:top;font-size:${TYPE.support}px;font-weight:700;color:${TIER_COLOR[f.templateItem.tier]};white-space:nowrap;width:56px;line-height:1.5">${escapeHtml(TIER_SHORT[f.templateItem.tier])}</td>
          <td style="padding:${SPACE.sm - 1}px 0;vertical-align:top;font-size:${TYPE.lead}px;font-weight:600;line-height:1.4">${escapeHtml(f.templateItem.title)}${
            statusContradictsSeverity(f.status, f.severity)
              ? // Named here too, not only on the detail row: this panel sits on the page some
                // readers are the only ones to open, and a Red entry whose own note reads benign
                // ("Expires 2029-04-01 (925 days out)") is unexplainable without it.
                `<span style="font-weight:400;font-size:${TYPE.support}px;color:${MUTED_TEXT}"> — recorded status: ${escapeHtml(STATUS_LABEL[f.status] ?? f.status)}, which disagrees with this rating</span>`
              : ""
          }${
            f.note
              ? `<div style="margin-top:${SPACE.xs - 1}px;font-size:${TYPE.support}px;font-weight:400;line-height:1.5;color:${NEUTRAL_TEXT}">${escapeHtml(truncate(f.note, 160))}</div>`
              : ""
          }</td>
        </tr>`,
          )
          .join("")}
        </tbody>
      </table>
      ${totalRed > risks.length ? `<div style="margin-top:${SPACE.sm}px;font-size:${TYPE.support}px;color:${MUTED_TEXT}">+ ${totalRed - risks.length} further Red ${totalRed - risks.length === 1 ? "item" : "items"} in the detail section.</div>` : ""}
    </div>`
      : `
    <div class="keep-together" style="margin-top:${SPACE.md + 2}px;padding-top:${SPACE.sm + 2}px;border-top:1px solid ${RULE_STRONG};font-size:${TYPE.body}px;line-height:1.55;color:${NEUTRAL_TEXT}">
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

  const legendItem = (color: string, glyph: string, text: string): string =>
    `<span style="white-space:nowrap;margin-right:${SPACE.lg}px"><span style="color:${color}">${glyph}</span> ${text}</span>`;

  // A PAGE OF ITS OWN, deliberately. The consultant-ux-design skill's rule for this section is to
  // design it as if it is the only page some readers open — and a reader who only opens one page
  // needs that page to be a whole page: a summary that trails off into the first two rows of Tier A
  // is a summary a buyer's advisor cannot forward, print or hand across a table on its own. It also
  // removes the alternative, which is worse: the detail section starting in whatever fraction of the
  // page is left over, which looks like a layout accident rather than a decision.
  return `
  <section class="page-break-after" style="margin-top:0">
    <h2 class="section-head" style="font-size:${TYPE.section}px;font-weight:700;letter-spacing:-0.01em;margin:0 0 ${SPACE.md}px 0;padding-left:${SPACE.md}px;border-left:3px solid ${accent}">Executive summary</h2>

    <!-- THE PAGE SOME READERS NEVER LEAVE (.claude/skills/consultant-ux-design/SKILL.md). Read top
         to bottom it answers, in order: what is the rating, how much of the audit is actually behind
         it, how the items fall out, and which items drove it. Nothing else belongs in this panel. -->
    <div class="keep-together" style="padding:${SPACE.md + 2}px ${SPACE.lg + 4}px ${SPACE.lg}px;border:1px solid ${RULE_STRONG};border-top:3px solid ${accent};background:${accentWash(accent, 0.05)}">
      <div style="display:flex;align-items:baseline;gap:${SPACE.md}px;flex-wrap:wrap">
        <span style="font-size:${TYPE.support}px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${MUTED_TEXT}">Overall</span>
        <span>${badgeWithCoverage(rollup.overall, rollup.overallCoverage, "md")}</span>
      </div>
      ${overrideBlock}
      <table style="width:100%;border-collapse:collapse;margin-top:${SPACE.md + 2}px;border-top:1px solid ${RULE_STRONG};border-bottom:1px solid ${RULE_STRONG}">
        <tbody>
        <tr>
          ${countCell("Red", counts.red, SEVERITY_COLOR.RED, SEVERITY_GLYPH.RED, true)}
          ${countCell("Yellow", counts.yellow, SEVERITY_COLOR.YELLOW, SEVERITY_GLYPH.YELLOW)}
          ${countCell("Green", counts.green, SEVERITY_COLOR.GREEN, SEVERITY_GLYPH.GREEN)}
          ${countCell("Unrated", counts.unrated, SEVERITY_NEUTRAL, UNRATED_GLYPH)}
          ${countCell("N/A", counts.notApplicable, SEVERITY_NEUTRAL, "—")}
        </tr>
        </tbody>
      </table>
      ${risksBlock}
    </div>

    <table style="width:100%;border-collapse:collapse;margin-top:${SPACE.lg + 2}px;border:1px solid ${RULE}">
      <thead>
        <tr style="background:${accent};color:${accentText}">
          <th style="width:12%;text-align:left;padding:7px 12px;font-size:${TYPE.label}px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em">Tier</th>
          <th style="width:41%;text-align:left;padding:7px 12px;font-size:${TYPE.label}px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em">What it covers</th>
          <th style="width:21%;text-align:left;padding:7px 12px;font-size:${TYPE.label}px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;white-space:nowrap">${SEVERITY_GLYPH.RED} / ${SEVERITY_GLYPH.YELLOW} / ${SEVERITY_GLYPH.GREEN}</th>
          <th style="width:26%;text-align:right;padding:7px 12px;font-size:${TYPE.label}px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em">Rating</th>
        </tr>
      </thead>
      <tbody>
        ${(Object.keys(TIER_LABEL) as Tier[]).map(tierRow).join("")}
      </tbody>
    </table>

    <!-- The legend is a key, so it is set as one: the label on its own line, the four marks on a
         line of their own where they sit under each other rather than running into the prose, and
         the roll-up rule as a closing sentence. The words are unchanged — only the line breaks
         between them are a design decision. -->
    <div class="keep-together" style="margin-top:${SPACE.sm + 2}px;padding:${SPACE.sm + 2}px ${SPACE.md + 2}px;background:#f7f8fa;border-left:3px solid ${RULE_STRONG};font-size:${TYPE.support}px;line-height:1.6;color:${NEUTRAL_TEXT}">
      <strong style="color:#0f172a;text-transform:uppercase;letter-spacing:0.1em;font-size:${TYPE.micro}px">How to read the ratings:</strong>
      <div style="margin-top:${SPACE.xs + 1}px">
      ${legendItem(SEVERITY_COLOR.RED, SEVERITY_GLYPH.RED, "Red — material issue")}${legendItem(SEVERITY_COLOR.YELLOW, SEVERITY_GLYPH.YELLOW, "Yellow — needs attention")}${legendItem(SEVERITY_COLOR.GREEN, SEVERITY_GLYPH.GREEN, "Green — no issue found")}<span style="white-space:nowrap"><span style="color:${SEVERITY_NEUTRAL}">${UNRATED_GLYPH}</span> not yet rated</span>.
      </div>
      <div style="margin-top:${SPACE.xs + 1}px">A tier is rated by its worst item: one Red item makes the tier Red regardless of how many Greens surround it.</div>
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

  // The two ratings are set as a two-column pair rather than as a sentence, so neither can be read
  // as qualifying the other: same label treatment, same size, side by side, both chips at full
  // strength. A design in which one of them is smaller, greyer or second in a sentence is the
  // silent substitution spec.md §6 forbids, arrived at by styling rather than by code.
  const ratingPair = (label: string, value: string): string => `
        <td style="padding:0 ${SPACE.xl}px ${SPACE.xs}px 0;vertical-align:top;width:50%">
          <div style="font-size:${TYPE.micro}px;font-weight:600;color:${MUTED_TEXT};letter-spacing:0.04em">${label}</div>
          <div style="margin-top:${SPACE.xs + 1}px">${value}</div>
        </td>`;

  return `<div class="keep-together" style="margin-top:${SPACE.lg}px;padding:${SPACE.md}px ${SPACE.lg}px ${SPACE.md + 2}px;border:1px solid ${RULE_STRONG};border-left:4px solid ${accent};background:#fcfdfd;font-size:${TYPE.body}px">
      <div style="font-size:${TYPE.micro}px;text-transform:uppercase;letter-spacing:0.12em;color:${MUTED_TEXT};font-weight:700">Consultant override${agrees ? " (matches the computed rating)" : ""}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:${SPACE.sm}px">
        <tbody>
          <tr>
            ${ratingPair("Consultant&#39;s rating:", badge(override))}
            ${ratingPair("Computed from the findings:", badgeWithCoverage(rollup.overall, rollup.overallCoverage))}
          </tr>
        </tbody>
      </table>
      <div style="margin-top:${SPACE.sm}px;font-size:${TYPE.support}px;color:${MUTED_TEXT}">Both values are shown deliberately — the consultant's judgement does not replace the computed roll-up.</div>
      ${data.overallRatingOverrideNote ? `<div style="margin-top:${SPACE.sm}px;padding-top:${SPACE.sm}px;border-top:1px solid ${RULE};color:#334155;font-size:${TYPE.body}px;line-height:1.55">${escapeHtml(data.overallRatingOverrideNote)}</div>` : ""}
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
        // Indented under the value and set a step down, the way a source note sits under a figure
        // in an exhibit — close enough to belong to the value, quiet enough not to be read as part
        // of it.
        `<div style="font-size:${TYPE.micro}px;line-height:1.5;color:${MUTED_TEXT};margin-top:${SPACE.xs - 1}px;padding-left:${SPACE.sm}px;border-left:1px solid ${RULE}">${escapeHtml(formatCitation(citation))}</div>`,
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
                <th scope="row" style="text-align:left;padding:5px ${SPACE.lg}px 5px 0;font-size:${TYPE.support}px;font-weight:600;line-height:1.5;color:${MUTED_TEXT};vertical-align:top;width:38%;border-top:1px solid ${RULE}">${escapeHtml(f.label)}</th>
                <td style="padding:5px 0;font-size:${TYPE.body}px;line-height:1.55;color:#334155;vertical-align:top;border-top:1px solid ${RULE}">${f.html}</td>
              </tr>`,
    )
    .join("");
  // A hairline above each pair rather than a box around the list: the rules give the labels and the
  // values each a single edge to hang from, which is what makes a run of six fields read as one
  // schedule instead of six loose lines.
  return `
            <table style="width:100%;border-collapse:collapse;margin-top:${SPACE.sm + 2}px">
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
  const layout = computeFieldTableLayout(columns, rows);

  const head = columns
    .map((c, i) => {
      const col = layout.columns[i];
      // A column label is a schema-declared string of any length, and holding it on one line was
      // half of what pushed this table off the paper — so it still wraps, at its SPACES. What it
      // must not do is wrap inside a word ("MONT"/"HLY COST", seen in a rendered PDF), which is
      // what the document-wide `overflow-wrap: anywhere` was doing to it; the column is sized to
      // fit the label's longest word, so switching that off here has nothing left to break.
      //
      // Where one word is longer than any share of the table could be — "ORGANISATION" in a
      // six-column register — it falls back to `break-word` and NOT to the document's `anywhere`.
      // The two differ in exactly the way that matters here: `anywhere` fills each line to the
      // edge and will split a word that would have fitted whole on the next line, which is how
      // "ASSIGNMENT ON CHANGE OF CONTROL" came out with "CONTROL" broken too; `break-word` splits
      // only the word that genuinely does not fit. `anywhere` was chosen document-wide for its
      // effect on min-content width, which is what auto table layout sizes columns from — inside a
      // table whose widths are declared, that effect is not wanted and not needed.
      const wrapRule = col.headerWordFits ? "overflow-wrap:normal;" : "overflow-wrap:break-word;";
      // The weight stays 600 deliberately. computeFieldTableLayout sizes this column from
      // UPPERCASE_EM, whose metrics carry ~8% headroom over a semibold system face; a true 700 is
      // wider than that headroom on macOS's SF, and the column would stop fitting its own label —
      // which is the "MONT"/"HLY COST" defect, reintroduced by a typographic preference.
      // `vertical-align: bottom` sits a one-line label on the same baseline as a label that wrapped
      // to three, so the rule under the header row is the only straight edge the eye needs.
      return `
                <th style="width:${col.widthPct.toFixed(2)}%;text-align:${align(c)};${wrapRule}padding:4px ${layout.padPx}px;font-size:${layout.headerFontPx}px;line-height:1.3;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;color:${NEUTRAL_TEXT};border-bottom:1px solid ${RULE_STRONG};vertical-align:bottom">${escapeHtml(c.label)}</th>`;
    })
    .join("");

  const body = rows
    .map((row) => {
      const cells = columns
        .map((c, i) => {
          const col = layout.columns[i];
          const raw = row[c.key];
          // An empty cell in an otherwise-filled row is a real, meaningful blank — the consultant
          // did not know. It prints as a blank cell, not as a dropped column.
          const formatted = raw === undefined || raw === "" ? "" : formatFieldValue(columnAsField(c), raw);
          const value = col.sized ? atomicValueHtml(formatted) : escapeHtml(formatted);
          // Same reasoning as the header: a sized column is wide enough for its own widest value,
          // so the value has no reason to break and `anywhere` is switched off. If the table is
          // dense enough that the column had to be squeezed below that width anyway, the value
          // breaks at the `<wbr>` between thousands groups rather than mid-digit. Free text keeps
          // breaking inside a word where it has to, but by `break-word` rather than `anywhere` —
          // see the header above for why the distinction is worth making.
          const wrapRule = col.sized ? "overflow-wrap:normal;" : "overflow-wrap:break-word;";
          return `<td style="text-align:${align(c)};${wrapRule}padding:4px ${layout.padPx}px;font-size:${layout.fontPx}px;line-height:1.45;color:#334155;border-bottom:1px solid ${RULE};vertical-align:top">${value}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  // `margin-top: 4px` on the table is not a spacing preference — tests/integration/report-layout
  // .itest.ts finds the structured table by it in order to measure the width it is laid out in.
  return `
            <div style="margin-top:${SPACE.md}px">
              <!-- Deliberately NOT keep-together: a 40-row register cannot fit on one page, and an
                   unsatisfiable avoid makes Chromium break wherever it likes (see tr.allow-break in
                   PRINT_STYLES). The <thead> repeats instead, which is the honest fix. -->
              <div style="font-size:${TYPE.micro}px;text-transform:uppercase;letter-spacing:0.1em;color:${MUTED_TEXT};font-weight:700;padding-bottom:${SPACE.xs}px">${escapeHtml(field.label)}</div>
              <table style="width:100%;border-collapse:collapse;margin-top:4px;border:1px solid ${RULE}">
                <thead><tr style="background:${accentWash(accent, 0.07)}">${head}</tr></thead>
                <tbody>${body}</tbody>
              </table>
            </div>`;
}

/**
 * Escaped cell text with an explicit break opportunity after each thousands separator and each
 * date hyphen — and nowhere else.
 *
 * `<wbr>` is a zero-width element: it prints nothing and contributes nothing to the PDF's text
 * layer. It exists only as the answer to "if this value has to break, where?", which under
 * `table-layout: fixed` is a question with only bad answers otherwise: overflow (drawn on top of
 * the next column) or a break mid-digit. `$1,234,567.89` breaking to `$1,`/`234,`/`567.89` is
 * degraded but still reads as the number it is.
 *
 * Only after a digit, so the leading minus of a negative amount never separates from its figure.
 */
function atomicValueHtml(text: string): string {
  return escapeHtml(text).replace(/(?<=\d)([,-])/g, "$1<wbr>");
}

// ---------------------------------------------------------------------------
// Column sizing for structured tables
// ---------------------------------------------------------------------------

/**
 * Approximate advance width of one character, as a fraction of the font size.
 *
 * WHY AN ESTIMATE AND NOT A MEASUREMENT. This module produces a string; there is no layout engine
 * in scope to ask, and the document is rendered by whatever Chromium and whatever font stack the
 * host happens to have (macOS resolves the stack to SF, a Linux server to DejaVu or Liberation).
 * So these are deliberately the WIDE end of that range plus a margin. Every value below was checked
 * against a measurement taken in the rendering engine itself and left 5-13% clear of it:
 *
 *   digit    measured 0.633em (SF), 0.636em (DejaVu)      → 0.67
 *   "-"      measured 0.425em in "2027-02-28"             → 0.45
 *   A-Z      measured 0.664em average, 0.757em worst case → 0.78
 *
 * An over-estimate costs a slightly wide column; an under-estimate costs an overflowing one, which
 * is the defect this exists to prevent. The first attempt put the hyphen at 0.34em and a six-column
 * register's term-end column came out 0.35px short — enough to wrap a date.
 *
 * Only the characters that appear in a money, percent or ISO-date value — plus upper-case letters,
 * for the column labels — need to be accurate. Everything else falls through to the default, which
 * is only ever used for free-text columns whose width is not content-derived anyway.
 */
/**
 * Upper-case advance widths, Helvetica's metrics scaled by 1.08 for headroom. A single average for
 * all 26 letters compounds badly over a long word: at 0.78em flat, "ORGANISATION" came out 21%
 * wider than it renders, which is a fifth of a column given away, while "ACCOUNT" had only 0.4%
 * to spare. Per letter, the same headroom holds for both (8% and 6%).
 */
const UPPERCASE_EM: Record<string, number> = {
  A: 0.72, B: 0.72, C: 0.78, D: 0.78, E: 0.72, F: 0.66, G: 0.84, H: 0.78, I: 0.3,
  J: 0.54, K: 0.72, L: 0.6, M: 0.9, N: 0.78, O: 0.84, P: 0.72, Q: 0.84, R: 0.78,
  S: 0.72, T: 0.66, U: 0.78, V: 0.72, W: 1.02, X: 0.72, Y: 0.72, Z: 0.66,
};

function charWidthEm(ch: string): number {
  if (ch >= "0" && ch <= "9") return 0.67;
  if (ch >= "A" && ch <= "Z") return UPPERCASE_EM[ch];
  switch (ch) {
    case "$":
      return 0.67;
    case "%":
      return 0.72;
    case ",":
    case ".":
    case ":":
    case "'":
      return 0.32;
    case "-":
    case "/":
      return 0.45;
    case " ":
      return 0.3;
    case "@":
      return 1.0;
    default:
      return 0.62;
  }
}

/** Width of a string in em. */
function estimateTextEm(text: string): number {
  let em = 0;
  for (const ch of text) em += charWidthEm(ch);
  return em;
}

/**
 * The width a structured table actually gets on the page, in CSS px.
 *
 * Derived, and confirmed by measuring a rendered document: A4 is 210mm wide, pdf.ts takes 14mm of
 * margin off each side (687.9px of content at 96dpi), the tier table's status column takes a fixed
 * STATUS_COLUMN_PX, and the finding cell spends 12px of padding on each side plus the 4px severity
 * rail.
 *
 * Every table this sizing applies to is rendered inside that cell (fieldTable is reached only from
 * findingRow), so one constant is honest here. If a structured table is ever rendered somewhere
 * else, it needs its own budget passed in rather than this one assumed.
 */
const PAGE_CONTENT_PX = 688;
/** Width of the tier table's "Status & rating" column: a status word, a badge, and nothing else.
 * Measured against its widest contents — "Not applicable" at 11.5px and the "Status & rating"
 * header itself, which is `nowrap` — with room to spare. */
const STATUS_COLUMN_PX = 150;
const FIELD_TABLE_WIDTH_PX = PAGE_CONTENT_PX - STATUS_COLUMN_PX - 24 - 4;

/**
 * Type sizes to try, densest table last. A 4-column inventory keeps the body size the rest of the
 * document uses; only a table that genuinely cannot hold its own values at that size steps down,
 * and it steps the horizontal padding down with it, which is where a surprising amount of a narrow
 * column's width goes (8px each side of an 8-column table is 128px of the 466 available).
 */
const FIELD_TABLE_DENSITY_STEPS = [
  { fontPx: 11.5, headerFontPx: 10.5, padPx: 8 },
  { fontPx: 10.5, headerFontPx: 9.5, padPx: 6 },
  { fontPx: 9.5, headerFontPx: 8.5, padPx: 5 },
  { fontPx: 8.5, headerFontPx: 7.5, padPx: 4 },
];

/** The floor for a free-text column: roughly seven lower-case characters. Below this a wrapping
 * column stops being a column and becomes a vertical stack of syllables. */
const MIN_FLEX_CONTENT_EM = 4.5;

/** Letter-spacing on column headers (`letter-spacing: 0.04em` in the markup), which is real width
 * and has to be counted or a header word is mis-sized by 4% per character. */
const HEADER_LETTER_SPACING_EM = 0.04;

export interface FieldColumnLayout {
  /** Declared width, as a percentage of the table. Fixed layout reads these from the first row. */
  widthPct: number;
  /** True for a column sized from its own content — money, percent, date, boolean. */
  sized: boolean;
  /** Content-box px this column's share works out to, at the chosen type size. */
  contentPx: number;
  /** Px the widest value in this column needs. 0 for a free-text column, which wraps by design. */
  valuePx: number;
  /** Px the longest single word of the column's label needs. */
  headerWordPx: number;
  /** Whether that word fits, i.e. whether the label can be forbidden from breaking mid-word. */
  headerWordFits: boolean;
}

export interface FieldTableLayout {
  fontPx: number;
  headerFontPx: number;
  padPx: number;
  columns: FieldColumnLayout[];
}

/**
 * Column widths for a structured table, sized from the values the table actually contains.
 *
 * THE DEFECT THIS REPLACES. The previous rule gave every column a share of the table proportional
 * to a hand-assigned weight — an atomic column 1, a free-text column 2. At four columns that
 * happened to be enough for a money value; at six it was 51.8px against the 77.6px
 * `$1,234,567.89` needs, and under `table-layout: fixed` a column that is too narrow for a nowrap
 * value does not clip it, it paints it over the next column. The schema permits eight columns, so
 * "tune the weights" was never going to be the answer: no fixed ratio can know that this table has
 * three money columns and that one of them holds seven figures.
 *
 * WHAT IT DOES INSTEAD. A money, percent, date or boolean column is measured — the widest value it
 * has to print, and the longest word of its label, at the type size in play — and gets exactly
 * that. Free-text columns wrap by design and split what is left. If the measured columns plus a
 * readable floor for the text columns do not fit, the whole table steps down a type size
 * (`FIELD_TABLE_DENSITY_STEPS`) rather than overflowing, which is the trade a consultant would
 * make: a dense eight-column register in smaller type is a normal-looking exhibit, and an
 * eight-column register printed on top of itself is not a deliverable at all.
 *
 * At the densest step, if even that does not fit, the measured columns are squeezed proportionally
 * and their values break at the `<wbr>` opportunities `atomicValueHtml` leaves between thousands
 * groups. That is the only case where a money value wraps, and it is reached only by a table that
 * cannot be laid out any other way; the guarantee that is never traded is the one fixed layout was
 * bought for, that nothing is pushed off the page and out of the PDF's text layer.
 */
export function computeFieldTableLayout(
  columns: ColumnDef[],
  rows: Record<string, string>[],
  availablePx: number = FIELD_TABLE_WIDTH_PX,
): FieldTableLayout {
  // Money, percent, date and boolean all have a bounded, known-width rendering, so they can be
  // sized exactly. `enum` deliberately is not: its options are consultant-authored strings that can
  // be sentences, so it is treated as free text and allowed to wrap.
  const sized = columns.map(
    (c) => c.kind === "money" || c.kind === "percent" || c.kind === "date" || c.kind === "boolean",
  );

  // Longest WORD, not the whole label: the label wraps at its spaces, so "Monthly cost" only needs
  // room for "Monthly". Measured upper-cased because `text-transform: uppercase` is what prints.
  const headerWordEm = columns.map((c) =>
    c.label
      .toUpperCase()
      .split(/\s+/)
      .reduce(
        (widest, word) =>
          Math.max(widest, estimateTextEm(word) + word.length * HEADER_LETTER_SPACING_EM),
        0,
      ),
  );

  const valueEm = columns.map((c, i) => {
    if (!sized[i]) return 0;
    const field = columnAsField(c);
    return rows.reduce((widest, row) => {
      const raw = row[c.key];
      if (raw === undefined || raw === "") return widest;
      return Math.max(widest, estimateTextEm(formatFieldValue(field, raw)));
    }, 0);
  });

  const flexCount = sized.filter((s) => !s).length;

  const demand = (step: (typeof FIELD_TABLE_DENSITY_STEPS)[number]) => {
    const sizedPx = columns.map((_, i) =>
      sized[i]
        ? Math.max(valueEm[i] * step.fontPx, headerWordEm[i] * step.headerFontPx) + 2 * step.padPx
        : 0,
    );
    const sizedTotal = sizedPx.reduce((sum, px) => sum + px, 0);
    // The HARD floor a free-text column needs: enough to be a column at all. Its label is not part
    // of it — a column headed "Account owner of record at the seller organisation" would demand
    // more than the whole table for one word of it.
    const flexTotal = flexCount * (MIN_FLEX_CONTENT_EM * step.fontPx + 2 * step.padPx);
    // The SOFT one: enough for every column's longest label word as well, so that nothing in the
    // header breaks inside a word.
    const flexLabelTotal = columns.reduce(
      (sum, _, i) =>
        sized[i]
          ? sum
          : sum +
            Math.max(MIN_FLEX_CONTENT_EM * step.fontPx, headerWordEm[i] * step.headerFontPx) +
            2 * step.padPx,
      0,
    );
    return { sizedPx, sizedTotal, flexTotal, flexLabelTotal };
  };

  // Two passes, because the two things being traded are not equal. Nothing may overflow, ever —
  // that is the hard pass. Beyond it, a step down in type buys whole column labels, and a label
  // reading "ASSIGN"/"MENT ON CHANGE OF CONTROL" in a client deliverable is worth half a point of
  // type to be rid of. So the largest type size that fits every label is preferred, and the
  // largest that merely fits the values is the fallback when no step can hold the labels.
  const fitsLabels = FIELD_TABLE_DENSITY_STEPS.find((step) => {
    const { sizedTotal, flexLabelTotal } = demand(step);
    return sizedTotal + flexLabelTotal <= availablePx;
  });
  const chosen =
    fitsLabels ??
    FIELD_TABLE_DENSITY_STEPS.find((step) => {
      const { sizedTotal, flexTotal } = demand(step);
      return sizedTotal + flexTotal <= availablePx;
    }) ??
    FIELD_TABLE_DENSITY_STEPS[FIELD_TABLE_DENSITY_STEPS.length - 1];

  const { sizedPx, sizedTotal, flexTotal } = demand(chosen);

  // The squeeze: only reachable at the densest step, and only by a table whose measured columns
  // alone exceed the page. Scaling them all by the same factor keeps the columns in proportion to
  // each other, so the widest value is still in the widest column.
  const squeeze =
    sizedTotal + flexTotal > availablePx && sizedTotal > 0
      ? Math.max(0, availablePx - flexTotal) / sizedTotal
      : 1;

  const widthsPx = sizedPx.map((px) => px * squeeze);
  const leftover = Math.max(0, availablePx - widthsPx.reduce((sum, px) => sum + px, 0));

  // What is left goes to the free-text columns, smallest need first.
  //
  // Equal shares are not right: they put "Vendor" and "Account owner of record at the seller
  // organisation" in identical columns, and — measured on a rendered page — left the longer label
  // too narrow for even its own first word. Shares proportional to the labels are not right
  // either: they starve the short column instead, so "VENDOR" was the word that broke. Filling the
  // smallest need first means a short label always fits, and the shortfall — when there is one —
  // lands on the long prose label, which is the one that can carry a break with the least harm.
  const flexNeedPx = columns.map((_, i) =>
    sized[i]
      ? 0
      : Math.max(MIN_FLEX_CONTENT_EM * chosen.fontPx, headerWordEm[i] * chosen.headerFontPx) +
        2 * chosen.padPx,
  );
  const flexIndexes = columns
    .map((_, i) => i)
    .filter((i) => !sized[i])
    .sort((a, b) => flexNeedPx[a] - flexNeedPx[b]);
  let pot = leftover;
  let remaining = flexIndexes.length;
  for (const i of flexIndexes) {
    widthsPx[i] = Math.min(flexNeedPx[i], pot / remaining);
    pot -= widthsPx[i];
    remaining--;
  }
  // Anything still unspent — every label was satisfied — is shared out in proportion to need, so
  // the column asked to hold a sentence ends up wider than the one holding a vendor name.
  const satisfiedTotal = flexIndexes.reduce((sum, i) => sum + flexNeedPx[i], 0);
  if (pot > 0 && satisfiedTotal > 0) {
    for (const i of flexIndexes) widthsPx[i] += (flexNeedPx[i] / satisfiedTotal) * pot;
  }
  // Every column sized and space still left over (a table of nothing but dates): hand it back
  // proportionally rather than leaving the table narrower than its container, which fixed layout
  // would otherwise distribute by its own rules and defeat the point of declaring widths at all.
  if (flexCount === 0 && leftover > 0 && sizedTotal > 0) {
    for (let i = 0; i < columns.length; i++) {
      widthsPx[i] += (widthsPx[i] / (sizedTotal * squeeze)) * leftover;
    }
  }

  const totalPx = widthsPx.reduce((sum, px) => sum + px, 0) || 1;

  return {
    fontPx: chosen.fontPx,
    headerFontPx: chosen.headerFontPx,
    padPx: chosen.padPx,
    columns: columns.map((_, i) => {
      const contentPx = widthsPx[i] - 2 * chosen.padPx;
      return {
        widthPct: (widthsPx[i] / totalPx) * 100,
        sized: sized[i],
        contentPx,
        valuePx: valueEm[i] * chosen.fontPx,
        headerWordPx: headerWordEm[i] * chosen.headerFontPx,
        headerWordFits: contentPx >= headerWordEm[i] * chosen.headerFontPx,
      };
    }),
  };
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
        <tr class="${rowClass}" style="border-bottom:1px solid ${RULE}">
          <td style="padding:${SPACE.sm + 2}px 12px;vertical-align:top;border-left:4px solid ${rail}">
            <div style="font-size:${TYPE.lead}px;font-weight:600;line-height:1.4;letter-spacing:-0.005em">${escapeHtml(f.templateItem.title)}</div>
            ${f.templateItem.description ? `<div style="color:${MUTED_TEXT};font-size:${TYPE.support}px;line-height:1.55;margin-top:${SPACE.xs - 1}px">${escapeHtml(f.templateItem.description)}</div>` : ""}
            ${f.note ? `<div style="margin-top:${SPACE.sm}px;font-size:${TYPE.body}px;line-height:1.55;color:#334155"><em style="color:${MUTED_TEXT};font-style:normal;font-weight:600">Finding:</em> ${escapeHtml(f.note)}</div>` : ""}
            ${
              contradiction
                ? // Moved out of the status column and into the body of the row. In the 150px column
                  // this sentence set as a six-line ragged stack beside a one-word badge — the
                  // least legible thing on the page, which for a sentence whose whole purpose is to
                  // stop a reader misreading a contradiction is the wrong way round. It stays
                  // inside the same <tr>, immediately under the finding it is about.
                  `<div class="keep-together" style="margin-top:${SPACE.sm}px;padding:${SPACE.sm - 2}px ${SPACE.md}px;border-left:3px solid ${SEVERITY_NEUTRAL};background:#f7f8fa;font-size:${TYPE.support}px;line-height:1.5;color:${NEUTRAL_TEXT};font-weight:600">Recorded status and rating disagree. The rating shown is the one this report&#39;s roll-up used.</div>`
                : ""
            }
            ${structuredBlock}
            ${f.evidenceCount ? `<div style="margin-top:${SPACE.sm}px;font-size:${TYPE.micro}px;letter-spacing:0.02em;color:${MUTED_TEXT}">${f.evidenceCount} document${f.evidenceCount === 1 ? "" : "s"} attached</div>` : ""}
          </td>
          <td style="padding:${SPACE.sm + 2}px 12px;text-align:right;vertical-align:top">
            <div style="font-size:${TYPE.micro}px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${MUTED_TEXT};margin-bottom:${SPACE.sm - 2}px;white-space:nowrap">${escapeHtml(STATUS_LABEL[f.status] ?? f.status)}</div>
            ${severity ? badge(severity) : neutralBadge(suppressSeverity ? "Not applicable" : "Not rated")}
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
  retentionSentence: string,
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

      // `vertical-align: top` on every cell, not the browser default of middle. Observed in a
      // rendered PDF: a two-line Document cell centred its neighbours against its own middle, so
      // "Excel workbook · 47 KB" sat halfway down beside "Recurring SaaS inventory" and the row read
      // as two half-rows. An exhibit's rows hang from one baseline.
      const cell = `padding:${SPACE.sm - 1}px 12px;font-size:${TYPE.support}px;color:${NEUTRAL_TEXT};vertical-align:top;line-height:1.5`;
      return `
    <tr class="keep-together" style="border-bottom:1px solid ${RULE}">
      <td style="${cell};font-size:${TYPE.body}px;color:#0f172a">
        ${escapeHtml(d.label ?? d.filename)}
        ${d.label ? `<div style="font-size:${TYPE.micro}px;color:${MUTED_TEXT};margin-top:1px">${escapeHtml(d.filename)}</div>` : ""}
      </td>
      <!-- NOT nowrap. "Excel workbook · 47 KB" is 22 characters in a 15% column with 79px of content
           box: under table-layout:fixed a nowrap cell that does not fit is painted over the column
           beside it, which is exactly what this descriptor was doing to "Evidence for". It is two
           facts joined by a separator and it may wrap between them. -->
      <td style="${cell}">${escapeHtml(descriptors.join(" · "))}</td>
      <td style="${cell}">${escapeHtml(d.findingTitle)}</td>
      <td style="${cell};white-space:nowrap">Tier ${d.tier}</td>
      <td style="${cell}">${provenance}</td>
    </tr>`;
    })
    .join("");

  const headCell = (width: string, label: string): string =>
    `<th style="width:${width};text-align:left;padding:7px 12px;font-size:${TYPE.label}px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em">${label}</th>`;

  return `
  <section style="margin-top:${SPACE.xl + 2}px">
    <div class="section-head" style="margin:0 0 ${SPACE.md}px 0;padding-left:${SPACE.md}px;border-left:3px solid ${accent}">
      <h3 style="font-size:${TYPE.subsection}px;font-weight:700;letter-spacing:-0.005em;line-height:1.35;margin:0">Appendix — Documents relied on</h3>
      <p style="font-size:${TYPE.support}px;line-height:1.6;color:${NEUTRAL_TEXT};margin:${SPACE.xs + 1}px 0 0 0;max-width:46em">${escapeHtml(retentionSentence)}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid ${RULE}">
      <thead>
        <tr style="background:${accent};color:${accentText}">
          ${headCell("30%", "Document")}
          ${headCell("15%", "Type")}
          ${headCell("24%", "Evidence for")}
          ${headCell("9%", "Tier")}
          ${headCell("22%", "Provided by")}
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
  <section class="keep-together" style="margin-top:${SPACE.lg + 4}px;padding-top:${SPACE.md}px;border-top:3px solid ${accent}">
    <div style="display:flex;align-items:center;gap:${SPACE.sm + 2}px;margin-bottom:${SPACE.sm + 2}px">
      ${logo ? `<img src="${escapeAttr(logo)}" alt="" style="height:20px;width:auto;object-fit:contain" />` : ""}
      <span style="font-weight:700;font-size:${TYPE.lead}px;letter-spacing:-0.005em">${escapeHtml(data.org.name)}</span>
      <span class="tnum" style="color:${MUTED_TEXT};font-size:${TYPE.support}px">· ${escapeHtml(data.businessName)} · ${formatDate(data.generatedAt)}</span>
    </div>
    <p style="margin:0;font-size:${TYPE.support}px;line-height:1.6;color:${NEUTRAL_TEXT};max-width:46em">${escapeHtml(REPORT_DISCLAIMER_TEXT)}</p>
    <!-- CloseCheck's entire presence in the deliverable: one line, at the smallest size on the page,
         below the firm's own sign-off. spec.md §6's whitelabel rule is what sets this ceiling —
         anything more competes with the firm whose name is on the cover. -->
    <p style="margin:${SPACE.sm + 2}px 0 0 0;font-size:9.5px;letter-spacing:0.02em;color:${MUTED_TEXT}">Prepared using CloseCheck.</p>
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
  // Quiet by design: a 1px rule rather than a 2px band, the firm's name in the document's ink rather
  // than in the accent, and the title in supporting grey. Running chrome is wayfinding, not a second
  // masthead — on pages 2..N the reader is reading findings, and anything heavier here competes with
  // the severity marks that are the only thing on the page that should catch the eye.
  return `<template id="closecheck-pdf-header"><div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:8px;color:#64748b;padding:0 14mm;box-sizing:border-box;">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:1px solid ${accent};padding-bottom:4px;">
    <div style="display:flex;align-items:center;">
      ${logo ? `<img src="${escapeAttr(logo)}" style="height:11px;width:auto;object-fit:contain;margin-right:6px;" />` : ""}
      <span style="font-size:8px;font-weight:700;letter-spacing:0.04em;color:#0f172a;">${escapeHtml(data.org.name)}</span>
    </div>
    <span style="font-size:7.5px;letter-spacing:0.03em;color:#64748b;">${escapeHtml(truncate(data.businessName, 48))} — Technology Due-Diligence Report</span>
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
  <div style="border-top:1px solid ${accent};padding-top:4px;display:flex;align-items:baseline;justify-content:space-between;">
    <span style="font-size:7.5px;letter-spacing:0.03em;color:#64748b;">${escapeHtml(data.org.name)} · Confidential — prepared for the recipient of this report</span>
    <span style="font-size:7.5px;color:#334155;font-weight:600;letter-spacing:0.04em;white-space:nowrap;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
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
