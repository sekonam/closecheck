import { describe, expect, it } from "vitest";
import { Severity, Tier } from "@prisma/client";
import {
  accentWash,
  countFindingsBySeverity,
  escapeHtml,
  normalizeAccentColor,
  readableTextOn,
  renderReportHtml,
  safeImageDataUri,
  topRiskFindings,
  type ReportData,
  type ReportFinding,
} from "./renderHtml";

function finding(over: Partial<ReportFinding> & { tier?: Tier; title?: string }): ReportFinding {
  const { tier = Tier.A, title = "An item", ...rest } = over;
  return {
    id: "f1",
    note: null,
    status: "PASS",
    severity: null,
    templateItem: { tier, title, description: null },
    ...rest,
  } as ReportFinding;
}

function report(over: Partial<ReportData> = {}): ReportData {
  return {
    businessName: "Harbour Street Bistro",
    templateName: "Restaurant — v3",
    generatedAt: new Date("2026-09-22T10:00:00Z"),
    org: { name: "Meridian Diligence", brandColorHex: "#0d7a6f", brandLogoDataUri: null },
    findings: [],
    ...over,
  };
}

describe("escapeHtml", () => {
  it("escapes every character that can break out of markup, including the apostrophe", () => {
    expect(escapeHtml(`<script>alert("x" + 'y')</script> & co`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot; + &#39;y&#39;)&lt;/script&gt; &amp; co",
    );
  });

  it("escapes the ampersand first so escapes are not double-escaped into entities", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("safeImageDataUri", () => {
  it("accepts a base64 image data URI", () => {
    const uri = "data:image/png;base64,iVBORw0KGgo=";
    expect(safeImageDataUri(uri)).toBe(uri);
  });

  it("rejects anything that is not a base64 image data URI", () => {
    expect(safeImageDataUri(null)).toBeNull();
    expect(safeImageDataUri("")).toBeNull();
    expect(safeImageDataUri("https://example.com/logo.png")).toBeNull();
    expect(safeImageDataUri("javascript:alert(1)")).toBeNull();
    expect(safeImageDataUri("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    // An attribute-breaking payload smuggled into an otherwise plausible URI.
    expect(safeImageDataUri('data:image/png;base64,AAA" onerror="alert(1)')).toBeNull();
  });
});

describe("normalizeAccentColor", () => {
  it("passes through a six-digit hex, lowercased", () => {
    expect(normalizeAccentColor("#0D7A6F")).toBe("#0d7a6f");
    expect(normalizeAccentColor("  #0d7a6f  ")).toBe("#0d7a6f");
  });

  it("expands three-digit shorthand", () => {
    expect(normalizeAccentColor("#f0a")).toBe("#ff00aa");
  });

  it("falls back to the default for anything that is not a hex color", () => {
    expect(normalizeAccentColor(null)).toBe("#0f172a");
    expect(normalizeAccentColor("red")).toBe("#0f172a");
    expect(normalizeAccentColor("#12345")).toBe("#0f172a");
    // The CSS-injection shape this guard exists for.
    expect(normalizeAccentColor("#fff;background:url(https://evil.test)")).toBe("#0f172a");
  });
});

describe("readableTextOn", () => {
  it("puts white text on a dark accent and dark text on a pale one", () => {
    expect(readableTextOn("#0d7a6f")).toBe("#ffffff");
    expect(readableTextOn("#0f172a")).toBe("#ffffff");
    expect(readableTextOn("#facc15")).toBe("#0f172a");
    expect(readableTextOn("#ffffff")).toBe("#0f172a");
  });
});

describe("accentWash", () => {
  it("produces an rgba wash of the accent", () => {
    expect(accentWash("#0d7a6f", 0.05)).toBe("rgba(13,122,111,0.05)");
  });
});

describe("countFindingsBySeverity", () => {
  it("counts by severity and keeps NOT_APPLICABLE out of the unrated bucket", () => {
    const counts = countFindingsBySeverity([
      finding({ id: "a", severity: Severity.RED, status: "FAIL" }),
      finding({ id: "b", severity: Severity.YELLOW, status: "PASS" }),
      finding({ id: "c", severity: Severity.GREEN, status: "PASS" }),
      finding({ id: "d", severity: null, status: "BLOCKED" }),
      // Stale severity left behind on a row later marked not applicable — must not be counted as
      // Red anywhere, matching computeSeverityRollup's exclusion rule.
      finding({ id: "e", severity: Severity.RED, status: "NOT_APPLICABLE" }),
    ]);
    expect(counts).toEqual({ red: 1, yellow: 1, green: 1, unrated: 1, notApplicable: 1 });
  });
});

describe("topRiskFindings", () => {
  it("returns Red findings in tier order, excluding NOT_APPLICABLE rows", () => {
    const risks = topRiskFindings([
      finding({ id: "c", tier: Tier.C, title: "C item", severity: Severity.RED, status: "FAIL" }),
      finding({ id: "a", tier: Tier.A, title: "A item", severity: Severity.RED, status: "FAIL" }),
      finding({ id: "na", tier: Tier.A, title: "NA item", severity: Severity.RED, status: "NOT_APPLICABLE" }),
      finding({ id: "y", tier: Tier.A, title: "Yellow item", severity: Severity.YELLOW, status: "FAIL" }),
    ]);
    expect(risks.map((f) => f.templateItem.title)).toEqual(["A item", "C item"]);
  });

  it("caps the list at the requested limit", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      finding({ id: `r${i}`, title: `Red ${i}`, severity: Severity.RED, status: "FAIL" }),
    );
    expect(topRiskFindings(many, 8)).toHaveLength(8);
  });
});

describe("renderReportHtml", () => {
  it("never prints a severity badge on a NOT_APPLICABLE finding", () => {
    // The regression: the roll-up excludes this row, so the tier header reads Green — a Red badge
    // on the row itself is a visible self-contradiction in the client deliverable.
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            id: "na",
            title: "Delivery platform account ownership",
            severity: Severity.RED,
            status: "NOT_APPLICABLE",
          }),
          finding({ id: "ok", title: "Domain ownership", severity: Severity.GREEN, status: "PASS" }),
        ],
      }),
    );
    const row = html.slice(html.indexOf("Delivery platform account ownership"));
    const rowEnd = row.indexOf("</tr>");
    expect(row.slice(0, rowEnd)).not.toContain(">Red<");
    expect(row.slice(0, rowEnd)).toContain("Not applicable");
  });

  it("prints the consultant override even when it agrees with the computed rating", () => {
    // spec.md §6: the override is always shown alongside the computed rating. The agreeing case is
    // where the consultant's note carries the most information, and it used to be dropped silently.
    const html = renderReportHtml(
      report({
        findings: [finding({ severity: Severity.RED, status: "FAIL" })],
        overallRatingOverride: Severity.RED,
        overallRatingOverrideNote: "Seller refused Tier C verification; rating reflects worst case.",
      }),
    );
    expect(html).toContain("Consultant override");
    expect(html).toContain("Seller refused Tier C verification");
    expect(html).toContain("Computed from the findings");
  });

  it("does not claim a computed rating exists when nothing has been rated", () => {
    const html = renderReportHtml(
      report({
        findings: [finding({ severity: null, status: "NOT_STARTED" })],
        overallRatingOverride: Severity.YELLOW,
        overallRatingOverrideNote: "Interim rating.",
      }),
    );
    expect(html).toContain("Not yet rated");
    expect(html).toContain("Consultant override");
    expect(html).not.toContain("the computed rating shown above is retained");
  });

  it("encodes severity with a shape as well as a color", () => {
    const html = renderReportHtml(
      report({
        findings: [
          finding({ id: "r", severity: Severity.RED, status: "FAIL" }),
          finding({ id: "y", severity: Severity.YELLOW, status: "PASS" }),
          finding({ id: "g", severity: Severity.GREEN, status: "PASS" }),
        ],
      }),
    );
    // Triangle / diamond / circle — the non-color channel. Plus the written word, so the encoding
    // survives both greyscale printing and a red/green color deficiency.
    expect(html).toContain("▲");
    expect(html).toContain("◆");
    expect(html).toContain("●");
    expect(html).toContain("How to read the ratings");
  });

  it("emits the pagination rules that keep a finding's title with its badge", () => {
    const html = renderReportHtml(report({ findings: [finding({})] }));
    expect(html).toContain("@page");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("display: table-header-group");
    expect(html).toContain('<tr class="keep-together"');
    expect(html).toContain("page-break-after");
  });

  it("emits running header/footer templates carrying the firm's brand and page numbers", () => {
    const html = renderReportHtml(report());
    expect(html).toContain('<template id="closecheck-pdf-header">');
    expect(html).toContain('<template id="closecheck-pdf-footer">');
    expect(html).toContain('class="pageNumber"');
    expect(html).toContain('class="totalPages"');
    // Whitelabel: the firm's name and accent, not CloseCheck's, on every page.
    expect(html).toContain("Meridian Diligence");
    expect(html).toContain("#0d7a6f");
  });

  it("escapes org- and finding-supplied text everywhere it lands in markup", () => {
    const html = renderReportHtml(
      report({
        businessName: `Bob's <script>alert(1)</script> Diner`,
        org: { name: `O'Neill & Partners`, brandColorHex: "#fff\";x:y", brandLogoDataUri: "javascript:alert(1)" },
        findings: [finding({ note: `<img src=x onerror="alert(1)">` })],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("Bob&#39;s");
    expect(html).toContain("O&#39;Neill &amp; Partners");
    // An invalid brand color never reaches a style attribute, and a non-image URI never reaches src.
    expect(html).not.toContain('x:y');
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("renders the engagement date on the cover when the caller supplies one", () => {
    const withDate = renderReportHtml(report({ engagementDate: new Date("2026-08-14T00:00:00Z"), dealStage: "Post-LOI" }));
    expect(withDate).toContain("Engagement date");
    expect(withDate).toContain("2026-08-14");
    expect(withDate).toContain("Post-LOI");
    // …and omits the row rather than passing the generation date off as the engagement date.
    expect(renderReportHtml(report())).not.toContain("Engagement date");
  });

  it("distinguishes a tier with no items from a tier whose items are all not applicable", () => {
    const html = renderReportHtml(
      report({
        findings: [
          finding({ id: "a", tier: Tier.A, severity: Severity.GREEN, status: "PASS" }),
          finding({ id: "b", tier: Tier.B, severity: Severity.RED, status: "NOT_APPLICABLE" }),
        ],
      }),
    );
    expect(html).toContain("No items");
    expect(html).toContain("Not applicable");
  });
});
