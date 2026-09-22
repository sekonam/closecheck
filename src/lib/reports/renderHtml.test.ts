import { describe, expect, it } from "vitest";
import { CheckMethod, Severity, Tier } from "@prisma/client";
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

  it("renders schema-declared scalar fields as labelled rows, with money and percent formatted", () => {
    // Template v3: the item declares its own fields and structuredData is keyed by them. Values are
    // stored canonically ("12000", "0.45") and must print as money/percent, not as bare numbers.
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.B,
            title: "Payment processor account standing",
            status: "FAIL",
            severity: Severity.YELLOW,
            templateItem: {
              tier: Tier.B,
              title: "Payment processor account standing",
              description: "Chargeback rate, holds and rolling reserve.",
              method: CheckMethod.MANUAL,
              fieldSchema: {
                fields: [
                  { key: "processor", label: "Processor", kind: "text" },
                  { key: "chargebackRate", label: "Chargeback rate", kind: "percent" },
                  { key: "reserveHeld", label: "Rolling reserve held", kind: "money" },
                  { key: "accountStatus", label: "Account standing", kind: "enum", options: ["good", "hold"] },
                  { key: "notes", label: "Notes", kind: "longtext" },
                ],
              },
            },
            structuredData: {
              processor: "Square",
              chargebackRate: "0.45",
              reserveHeld: "12000",
              accountStatus: "hold",
              // Left blank by the consultant — must not produce an empty labelled row.
              notes: "",
            },
          }),
        ],
      }),
    );

    expect(html).toContain("Rolling reserve held");
    expect(html).toContain("$12,000.00");
    expect(html).toContain("Chargeback rate");
    expect(html).toContain("0.45%");
    expect(html).toContain("Account standing");
    // A labelled definition list, not the old run-on grey line.
    expect(html).toContain('<th scope="row"');
    expect(html).not.toContain("Processor: Square");
    // The blank field is absent entirely, label and all.
    expect(html).not.toContain(">Notes<");
  });

  it("renders a table field as a real table and paginates it without splitting a row", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      tool: `Tool ${i + 1}`,
      monthlyCost: `${(i + 1) * 15}`,
      transfers: i % 2 === 0 ? "transfers" : "must-rebuild",
    }));
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.B,
            title: "Recurring SaaS inventory",
            status: "PASS",
            severity: Severity.YELLOW,
            templateItem: {
              tier: Tier.B,
              title: "Recurring SaaS inventory",
              description: null,
              method: CheckMethod.MANUAL,
              fieldSchema: {
                fields: [
                  {
                    key: "tools",
                    label: "Recurring tools and subscriptions",
                    kind: "table",
                    columns: [
                      { key: "tool", label: "Tool", kind: "text" },
                      { key: "monthlyCost", label: "Monthly cost", kind: "money" },
                      { key: "transfers", label: "On sale", kind: "enum", options: ["transfers", "must-rebuild"] },
                    ],
                  },
                ],
              },
            },
            structuredData: { tools: rows },
          }),
        ],
      }),
    );

    // Column labels from the schema, every row present, money formatted per cell.
    expect(html).toContain("Monthly cost");
    expect(html).toContain("Tool 1");
    expect(html).toContain("Tool 12");
    expect(html).toContain("$180.00");
    expect(html).toContain("<thead>");
    // A 12-row table cannot be kept on one page with its finding. The outer row opts out of the
    // blanket avoid-break rule so the break lands BETWEEN inner rows (which keep it) rather than
    // through one — see PRINT_STYLES' tr.allow-break.
    expect(html).toContain('<tr class="allow-break"');
    expect(html).toContain("tr.allow-break { break-inside: auto");
  });

  it("keeps a short table together with its finding", () => {
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.B,
            title: "Recurring SaaS inventory",
            templateItem: {
              tier: Tier.B,
              title: "Recurring SaaS inventory",
              description: null,
              method: CheckMethod.MANUAL,
              fieldSchema: {
                fields: [
                  {
                    key: "tools",
                    label: "Recurring tools",
                    kind: "table",
                    columns: [{ key: "tool", label: "Tool", kind: "text" }],
                  },
                ],
              },
            },
            structuredData: { tools: [{ tool: "Mailchimp" }, { tool: "Calendly" }] },
          }),
        ],
      }),
    );
    expect(html).toContain('<tr class="keep-together"');
    expect(html).not.toContain('<tr class="allow-break"');
  });

  it("still renders legacy v1/v2 findings, which carry the three fixed keys and no schema", () => {
    // An Audit stays pinned to the Template version it started on (spec.md §5), so v1/v2-shaped
    // findings outlive v3 — and a report generated from one must not silently lose content.
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.B,
            title: "POS system contract terms",
            status: "FAIL",
            severity: Severity.RED,
            templateItem: { tier: Tier.B, title: "POS system contract terms", description: null },
            structuredData: {
              transferable: "no",
              penaltyAmount: "$4,800",
              penaltyBasis: "3 months' remaining fees",
            },
          }),
        ],
      }),
    );
    expect(html).toContain("Transfers to the buyer");
    expect(html).toContain("Early-termination penalty");
    // Printed verbatim: v1/v2 never canonicalised these, so they are not run through the money
    // formatter.
    expect(html).toContain("$4,800");
    expect(html).toContain("3 months&#39; remaining fees");
  });

  it("never dumps a Tier A check runner's raw output into the report", () => {
    // src/lib/audit/tierA.ts stores its result object in the same column, with no schema and none of
    // the legacy keys. The finding note already says what was observed; the JSON is internal.
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.A,
            title: "Domain/registrar ownership and expiration",
            status: "PASS",
            severity: Severity.GREEN,
            note: "Registrar: Namecheap. Expires 2027-04-02 (557 days out).",
            templateItem: {
              tier: Tier.A,
              title: "Domain/registrar ownership and expiration",
              description: null,
              method: CheckMethod.AUTOMATED,
            },
            structuredData: {
              registrar: "Namecheap",
              expiryDate: "2027-04-02",
              nameservers: ["ns1.example.test", "ns2.example.test"],
            },
          }),
        ],
      }),
    );
    expect(html).toContain("Registrar: Namecheap. Expires 2027-04-02");
    expect(html).not.toContain("ns1.example.test");
    expect(html).not.toContain("expiryDate");
  });

  it("ignores a fieldSchema on an automated item, whose structuredData is runner output", () => {
    // Mirrors the audit form's guard: structuredData doubles as the automated runner's output store.
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.A,
            title: "DNS provider fingerprint",
            templateItem: {
              tier: Tier.A,
              title: "DNS provider fingerprint",
              description: null,
              method: CheckMethod.AUTOMATED,
              fieldSchema: { fields: [{ key: "provider", label: "Provider", kind: "text" }] },
            },
            structuredData: { provider: "Cloudflare" },
          }),
        ],
      }),
    );
    expect(html).not.toContain(">Provider<");
    expect(html).not.toContain("Cloudflare");
  });

  it("never leaks internal guidance into the client deliverable", () => {
    // guidance/severityGuidance are the product's internal methodology (prisma/schema.prisma's
    // TemplateItem). They were split out of `description` precisely because they had leaked into a
    // report a consultant hands to a buyer. Only `description` is client-facing.
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.B,
            title: "POS system contract terms",
            templateItem: {
              tier: Tier.B,
              title: "POS system contract terms",
              description: "Term length, auto-renewal and early-termination exposure.",
              guidance: "INTERNAL: read §7 of the merchant agreement; the penalty is usually buried there.",
              severityGuidance: "INTERNAL: Red above 3 months' fees, Yellow above one.",
            } as ReportFinding["templateItem"],
          }),
        ],
      }),
    );
    expect(html).toContain("Term length, auto-renewal and early-termination exposure.");
    expect(html).not.toContain("INTERNAL");
    expect(html).not.toContain("merchant agreement");
    expect(html).not.toContain("3 months&#39; fees");
  });

  it("escapes schema-driven labels and values", () => {
    const html = renderReportHtml(
      report({
        findings: [
          finding({
            tier: Tier.B,
            title: "Platform contract",
            templateItem: {
              tier: Tier.B,
              title: "Platform contract",
              description: null,
              method: CheckMethod.MANUAL,
              fieldSchema: {
                fields: [
                  { key: "vendor", label: "Vendor", kind: "text" },
                  {
                    key: "tools",
                    label: "Tools",
                    kind: "table",
                    columns: [{ key: "tool", label: "Tool", kind: "text" }],
                  },
                ],
              },
            },
            structuredData: {
              vendor: `<script>alert(1)</script>`,
              tools: [{ tool: `<img src=x onerror="alert(1)">` }],
            },
          }),
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;script&gt;");
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
