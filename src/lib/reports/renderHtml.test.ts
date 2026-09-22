import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckMethod, Severity, Tier } from "@prisma/client";
import {
  accentWash,
  computeFieldTableLayout,
  countFindingsBySeverity,
  escapeHtml,
  normalizeAccentColor,
  pageTextAccent,
  readableTextOn,
  renderReportHtml,
  safeImageDataUri,
  statusContradictsSeverity,
  structuralAccent,
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

describe("appendix", () => {
  const document = {
    findingTitle: "Primary business-system contract terms",
    tier: Tier.B,
    filename: "scan_0043.pdf",
    label: "Toast MSA, executed" as string | null,
    mimeType: "application/pdf" as string | null,
    sizeBytes: 2_411_724 as number | null,
    attributedTo: "J. Smith" as string | null,
    attachedAt: new Date("2026-09-14T09:30:00Z"),
  };

  it("is omitted entirely when the consultant did not opt in", () => {
    expect(renderReportHtml(report())).not.toContain("Appendix");
    expect(renderReportHtml(report({ appendixDocuments: [] }))).not.toContain("Appendix");
  });

  it("gives a buyer's advisor something they can check", () => {
    // A bare filename is not checkable. What the document was, how big, who attached it and when
    // are — that is the difference between a listing and a decoration.
    const html = renderReportHtml(report({ appendixDocuments: [document] }));
    expect(html).toContain("Toast MSA, executed");
    expect(html).toContain("scan_0043.pdf"); // real filename kept alongside the label
    expect(html).toContain("PDF");
    expect(html).toContain("2.3 MB");
    // Reads "J. Smith, 2026-09-14"; the date sits in its own nowrap span so that a long attributor
    // name can wrap inside the column without the ISO date splitting as "2026-09-" / "14".
    expect(html).toContain(`J. Smith, <span style="white-space:nowrap">2026-09-14</span>`);
    expect(html).toContain("Primary business-system contract terms");
  });

  it("does not reproduce the documents themselves", () => {
    // Embedding a seller's executed contracts into a PDF the buyer can forward anywhere is a
    // confidentiality decision nobody made. The appendix says the firm can provide them.
    const html = renderReportHtml(report({ appendixDocuments: [document] }));
    expect(html).toContain("not reproduced here");
    expect(html).toContain("on request");
  });

  it("degrades for rows attached before provenance was recorded", () => {
    const html = renderReportHtml(
      report({
        appendixDocuments: [
          { ...document, label: null, mimeType: null, sizeBytes: null, attributedTo: null },
        ],
      }),
    );
    expect(html).toContain("scan_0043.pdf");
    expect(html).toContain("2026-09-14");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("escapes a hostile filename", () => {
    const html = renderReportHtml(
      report({
        appendixDocuments: [{ ...document, label: null, filename: `<img src=x onerror=alert(1)>` }],
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("citations in the report", () => {
  const schema = {
    fields: [
      { key: "transferable", label: "Transfers to the buyer", kind: "enum", options: ["transfers", "does-not-transfer"] },
      { key: "penaltyAmount", label: "Early-termination penalty", kind: "money" },
    ],
  };

  function citedFinding(citations: Map<string, unknown[]>) {
    return finding({
      tier: Tier.B,
      title: "Primary business-system contract terms",
      structuredData: { transferable: "does-not-transfer", penaltyAmount: "12000" },
      templateItem: {
        tier: Tier.B,
        title: "Primary business-system contract terms",
        description: null,
        fieldSchema: schema,
        method: CheckMethod.MANUAL,
      },
      citations,
    } as never);
  }

  it("prints the clause under the value it supports", () => {
    // This is the difference between the report asserting something and showing the reader what it
    // read — a buyer's counsel can judge the rating without opening the file or asking anyone.
    const html = renderReportHtml(
      report({
        findings: [
          citedFinding(
            new Map([
              [
                "transferable",
                [
                  {
                    fieldKey: "transferable",
                    evidenceId: "ev1",
                    documentName: "toast-msa-2023.pdf",
                    locator: "§14.2, p.7",
                    excerpt: "This Agreement may not be assigned",
                  },
                ],
              ],
            ]),
          ),
        ],
      }),
    );
    expect(html).toContain("§14.2, p.7 of toast-msa-2023.pdf");
    expect(html).toContain("This Agreement may not be assigned");
  });

  it("renders values with no citation exactly as before", () => {
    const html = renderReportHtml(report({ findings: [citedFinding(new Map())] }));
    expect(html).toContain("Early-termination penalty");
    expect(html).toContain("$12,000.00");
  });

  it("escapes a hostile excerpt", () => {
    const html = renderReportHtml(
      report({
        findings: [
          citedFinding(
            new Map([
              [
                "transferable",
                [
                  {
                    fieldKey: "transferable",
                    evidenceId: "ev1",
                    documentName: "x.pdf",
                    excerpt: `<script>alert(1)</script>`,
                  },
                ],
              ],
            ]),
          ),
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
// The four defects found by rendering real PDFs and reading the pages.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The four defects found by rendering real PDFs and reading the pages — fixtures shared by the
// declared-width suite below and the browser-measured suite at the end of this file.
// ---------------------------------------------------------------------------

// The defect, reproduced against a real PDF: one 600-character unbroken token in ONE finding's
// note widened the shared tier table past A4, and every OTHER finding's structured columns were
// clipped off the right edge — absent from the PDF's text layer, not merely overflowing it.
const saasSchema = {
  fields: [
    {
      key: "tools",
      label: "Recurring SaaS inventory",
      kind: "table",
      columns: [
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "monthlyCost", label: "Monthly cost", kind: "money" },
        { key: "termEnd", label: "Term end", kind: "date" },
        { key: "owner", label: "Account owner of record at the seller organisation", kind: "text" },
      ],
    },
  ],
};

function poisonedReport(): ReportData {
  return report({
    findings: [
      finding({
        id: "poison",
        tier: Tier.B,
        title: "Third-party integration identifiers",
        status: "FAIL",
        severity: Severity.YELLOW,
        note: "The seller's export emitted this identifier verbatim: " + "A".repeat(600),
        templateItem: {
          tier: Tier.B,
          title: "Third-party integration identifiers",
          description: null,
          method: CheckMethod.MANUAL,
        },
      }),
      finding({
        id: "saas",
        tier: Tier.B,
        title: "Recurring SaaS inventory",
        status: "FAIL",
        severity: Severity.RED,
        templateItem: {
          tier: Tier.B,
          title: "Recurring SaaS inventory",
          description: null,
          method: CheckMethod.MANUAL,
          fieldSchema: saasSchema,
        },
        structuredData: {
          tools: Array.from({ length: 40 }, (_, i) => ({
            vendor: `Vendor ${i + 1}`,
            monthlyCost: `${137 + i}`,
            termEnd: "2027-02-11",
            owner: "owner@seller.example",
          })),
        },
      }),
    ],
    appendixDocuments: [
      {
        findingTitle: "Recurring SaaS inventory",
        tier: Tier.B,
        filename: "seller_export_" + "b".repeat(180) + ".pdf",
        label: null,
        mimeType: "application/pdf",
        sizeBytes: 2_411_724,
        attributedTo: "J. Smith",
        attachedAt: new Date("2026-09-14T09:30:00Z"),
      },
    ],
  });
}

interface Col {
  key: string;
  label: string;
  kind: string;
}

const FOUR_COLUMNS: Col[] = [
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "monthlyCost", label: "Monthly cost", kind: "money" },
  { key: "termEnd", label: "Term end", kind: "date" },
  { key: "owner", label: "Account owner of record at the seller organisation", kind: "text" },
];

const SIX_COLUMNS: Col[] = [
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "monthlyCost", label: "Monthly cost", kind: "money" },
  { key: "annualCost", label: "Annual cost", kind: "money" },
  { key: "termEnd", label: "Term end", kind: "date" },
  { key: "assignment", label: "Assignment on change of control", kind: "text" },
  { key: "owner", label: "Account owner of record at the seller organisation", kind: "text" },
];

const EIGHT_COLUMNS: Col[] = [
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "monthlyCost", label: "Monthly cost", kind: "money" },
  { key: "annualCost", label: "Annual cost", kind: "money" },
  { key: "setupFee", label: "Setup fee", kind: "money" },
  { key: "uplift", label: "Renewal uplift", kind: "percent" },
  { key: "termEnd", label: "Term end", kind: "date" },
  { key: "renewsOn", label: "Renews on", kind: "date" },
  { key: "owner", label: "Account owner", kind: "text" },
];

const REGISTER_SHAPES: [string, Col[]][] = [
  ["four", FOUR_COLUMNS],
  ["six", SIX_COLUMNS],
  ["eight", EIGHT_COLUMNS],
];

/** Rows carrying the widest value each kind plausibly reaches: a seven-figure amount, a full ISO
 * date, and a vendor name with no break opportunity anywhere in it. */
function registerRows(columns: Col[]): Record<string, string>[] {
  const money = ["419", "144000", "1234567.89"];
  const dates = ["2027-02-28", "2028-01-01", "2026-12-31"];
  return [0, 1, 2].map((i) => {
    const row: Record<string, string> = {};
    for (const [ci, c] of columns.entries()) {
      if (c.kind === "money") row[c.key] = money[(i + ci) % money.length];
      else if (c.kind === "date") row[c.key] = dates[(i + ci) % dates.length];
      else if (c.kind === "percent") row[c.key] = "12.5";
      else if (c.key === "vendor") row[c.key] = i === 1 ? "SuperLongUnbrokenVendorName" : `Vendor ${i + 1}`;
      else row[c.key] = "owner@seller.example";
    }
    return row;
  });
}

function registerReport(columns: Col[]): ReportData {
  return report({
    findings: [
      finding({
        id: "saas",
        tier: Tier.B,
        title: "Recurring SaaS inventory",
        status: "FAIL",
        severity: Severity.RED,
        templateItem: {
          tier: Tier.B,
          title: "Recurring SaaS inventory",
          description: null,
          method: CheckMethod.MANUAL,
          fieldSchema: { fields: [{ key: "tools", label: "Vendor register", kind: "table", columns }] },
        },
        structuredData: { tools: registerRows(columns) },
      }),
    ],
  });
}

describe("table width can never push content off the paper", () => {
  // -------------------------------------------------------------------------
  // Column sizing.
  //
  // These assertions deliberately do NOT check that the document contains "table-layout: fixed" or
  // "overflow-wrap: anywhere". The previous version of these tests did exactly that, and passed
  // while six-column money columns were painting on top of their neighbours — the presence of a
  // constant string in the output is a constant, and cannot fail for the reason the test was
  // written for. What follows measures the widths the document declares against the widths the
  // values actually need. The browser suite at the end of this file then measures the same thing
  // in a real layout engine.
  // -------------------------------------------------------------------------

  /**
   * The width a structured table actually occupies on the page, in CSS px. A4 is 210mm; pdf.ts
   * takes 14mm of margin off each side, leaving 687.9px of content at 96dpi; the tier table's
   * status column takes a fixed 150px and the finding cell spends 12px of padding a side plus the
   * 4px severity rail. Measured in Chromium at 509.5px — and asserted, not assumed, by the browser
   * suite below.
   */
  const FIELD_TABLE_PX = 510;

  /**
   * A deliberately CONSERVATIVE lower bound on the rendered width of a string, derived here rather
   * than imported from renderHtml so that this is a genuine second opinion on its estimator.
   *
   * The narrowest digit among the fonts this document's stack can resolve to is Helvetica/Arial's
   * 0.556em (SF and DejaVu Sans are both ~0.634em), so 0.55em per digit is a width no rendering can
   * come in under. A column narrower than this overflows in every font, not merely in some.
   */
  function narrowestWidthPx(text: string, fontPx: number, letterSpacingEm = 0): number {
    let em = 0;
    for (const ch of text) {
      if (/[0-9$]/.test(ch)) em += 0.55;
      else if (/[.,-]/.test(ch)) em += 0.25;
      else em += 0.5; // upper-case letters included: Helvetica's narrowest is "I" at 0.278em.
      em += letterSpacingEm;
    }
    return em * fontPx;
  }

  interface ParsedTable {
    headers: { style: string; label: string; widthPct: number }[];
    cells: { style: string; html: string }[];
    fontPx: number;
    headerFontPx: number;
    padPx: number;
    contentPx: (index: number) => number;
    column: (index: number) => string[];
  }

  /** The structured table a finding renders, picked out by the signature of its own opening tag. */
  function structuredTable(html: string): ParsedTable {
    const open = html.indexOf('<table style="width:100%;border-collapse:collapse;margin-top:4px;');
    expect(open).toBeGreaterThan(-1);
    const markup = html.slice(open, html.indexOf("</table>", open));
    const number = (style: string, prop: RegExp): number => Number(prop.exec(style)?.[1]);

    const headers = [...markup.matchAll(/<th style="([^"]*)"[^>]*>([^<]*)</g)].map((m) => ({
      style: m[1],
      label: m[2],
      widthPct: number(m[1], /width:([\d.]+)%/),
    }));
    const cells = [...markup.matchAll(/<td style="([^"]*)"[^>]*>(.*?)<\/td>/g)].map((m) => ({
      style: m[1],
      html: m[2],
    }));
    const padPx = number(cells[0].style, /padding:[\d.]+px ([\d.]+)px/);

    return {
      headers,
      cells,
      padPx,
      fontPx: number(cells[0].style, /font-size:([\d.]+)px/),
      headerFontPx: number(headers[0].style, /font-size:([\d.]+)px/),
      // Content-box px the declared width works out to on the page, padding removed.
      contentPx: (index) => (headers[index].widthPct / 100) * FIELD_TABLE_PX - 2 * padPx,
      column: (index) => cells.filter((_, i) => i % headers.length === index).map((c) => c.html),
    };
  }

  /** A cell's content as it can actually break: `<wbr>` is the only break opportunity renderHtml
   * leaves in a sized column, so these are the chunks that each have to fit on one line. */
  function unbreakableSegments(cellHtml: string): string[] {
    return cellHtml.split("<wbr>").filter((segment) => segment !== "");
  }

  // The defect, read off a rendered 6-column register: "$419.00 $5,028.002027-02-2Assignment", and
  // row 2 "$12,000.0$144,0002028-01-01uperLongUnbr". Under fixed layout a cell too narrow for its
  // value does not clip — it draws on top of its neighbour — so every column has to be wide enough
  // for the widest chunk it can be asked to put on one line. No fixed ratio of column weights can
  // know that this register has three money columns and that one holds seven figures.
  it.each(REGISTER_SHAPES)(
    "gives a %s-column register's money and date columns room for their own values",
    (_shape, columns) => {
      const table = structuredTable(renderReportHtml(registerReport(columns)));
      expect(table.headers).toHaveLength(columns.length);

      for (const [i, column] of columns.entries()) {
        if (column.kind === "text") continue;
        for (const cell of table.column(i)) {
          for (const segment of unbreakableSegments(cell)) {
            expect(table.contentPx(i)).toBeGreaterThanOrEqual(
              narrowestWidthPx(segment, table.fontPx),
            );
          }
        }
      }
    },
  );

  // Passes before this fix as well as after, deliberately: it guards the EARLIER deliberate fix
  // (a term end must never print as "2027-02-" / "28") against the new wrapping rules, rather than
  // the overprinting defect above. The old code held these cells with `white-space: nowrap`, which
  // kept them on one line by drawing them over the next column; this one keeps them on one line by
  // giving them a column wide enough to sit in.
  it("prints a money value whole in any register not dense enough to need otherwise", () => {
    // The guarantee the earlier fix bought — a term end never reading "2027-02-" / "28" — kept by
    // SIZING the column rather than by a `nowrap` that fixed layout does not honour. At four and
    // six columns nothing has to break at all, so no <wbr> in any cell is ever reached.
    for (const columns of [FOUR_COLUMNS, SIX_COLUMNS]) {
      const table = structuredTable(renderReportHtml(registerReport(columns)));
      for (const [i, column] of columns.entries()) {
        if (column.kind === "text") continue;
        for (const cell of table.column(i)) {
          const whole = cell.replace(/<wbr>/g, "");
          expect(table.contentPx(i)).toBeGreaterThanOrEqual(narrowestWidthPx(whole, table.fontPx));
        }
      }
    }
  });

  it("keeps the ordinary four-column register at the document's own type size", () => {
    // A dense register steps its type down to fit; an ordinary one must not, or every report pays
    // for the eight-column case.
    const table = structuredTable(renderReportHtml(registerReport(FOUR_COLUMNS)));
    expect(table.fontPx).toBe(11.5);
    expect(table.padPx).toBe(8);
  });

  it("steps a dense register's type down rather than letting it overflow", () => {
    const table = structuredTable(renderReportHtml(registerReport(EIGHT_COLUMNS)));
    expect(table.fontPx).toBeLessThan(11.5);
    // An exhibit set small is a different thing from an exhibit set on top of itself, but there is
    // still a floor.
    expect(table.fontPx).toBeGreaterThanOrEqual(8.5);
  });

  it("declares column widths that add up to the table, which is what fixed layout distributes", () => {
    for (const [, columns] of REGISTER_SHAPES) {
      const table = structuredTable(renderReportHtml(registerReport(columns)));
      const total = table.headers.reduce((sum, h) => sum + h.widthPct, 0);
      expect(total).toBeGreaterThan(99.5);
      expect(total).toBeLessThan(100.5);
      for (const header of table.headers) expect(header.widthPct).toBeGreaterThan(0);
    }
  });

  // Observed on the same rendered page: "MONT/HLY COST" and "ANNU/AL COST". `overflow-wrap:
  // anywhere` is inherited by the column headers too, and a header short of width breaks inside a
  // word rather than at the space it was given. Breaking "Monthly cost" after "Monthly" is fine;
  // breaking "Monthly" is not.
  it("gives every sized column's label room for its longest word, so no header breaks mid-word", () => {
    for (const [, columns] of REGISTER_SHAPES) {
      const table = structuredTable(renderReportHtml(registerReport(columns)));
      for (const [i, column] of columns.entries()) {
        // A free-text column's label can be a sentence ("Account owner of record at the seller
        // organisation"); one word of it may be wider than any share of the table, and it is
        // allowed to break. Sized columns have short labels and no such excuse.
        if (column.kind === "text") continue;
        const longestWord = column.label
          .toUpperCase()
          .split(/\s+/)
          .reduce((a, b) => (a.length >= b.length ? a : b), "");
        expect(table.contentPx(i)).toBeGreaterThanOrEqual(
          narrowestWidthPx(longestWord, table.headerFontPx, 0.04),
        );
      }
    }
  });

  it("switches the break-anywhere rule off only where the column was sized for its content", () => {
    // Free text is what the document-wide rule exists for and keeps it; a sized column has no use
    // for it and every reason to refuse it — it is what turns $144,000.00 into $144,0 / 00.00.
    const table = structuredTable(renderReportHtml(registerReport(SIX_COLUMNS)));
    for (const [i, column] of SIX_COLUMNS.entries()) {
      const style = table.cells[i].style;
      if (column.kind === "text") expect(style).not.toContain("overflow-wrap:normal");
      else expect(style).toContain("overflow-wrap:normal");
    }
  });

  it("leaves a break opportunity inside an atomic value only between its own groups", () => {
    // The last resort for a register too dense to fit at any type size. $1,/234,/567.89 is degraded
    // and still reads as the number it is, which neither an overflow nor a break by character does.
    const table = structuredTable(renderReportHtml(registerReport(EIGHT_COLUMNS)));
    const seven = table.column(1).find((cell) => cell.includes("1,"));
    expect(unbreakableSegments(seven ?? "")).toEqual(["$1,", "234,", "567.89"]);
    const dateColumn = EIGHT_COLUMNS.findIndex((c) => c.key === "termEnd");
    expect(unbreakableSegments(table.column(dateColumn)[0])).toEqual(["2026-", "12-", "31"]);
  });

  it("squeezes the measured columns rather than overflowing when even the smallest type will not do", () => {
    // Eight money columns of seven-figure amounts: the schema's worst case, and the one shape no
    // type size can hold. Written against computeFieldTableLayout directly because the squeeze is
    // not reachable through a rendered document at the page width the report is laid out at — and
    // it is the branch that decides whether an unlayoutable table degrades or overprints.
    const columns = Array.from({ length: 8 }, (_, i) => ({
      key: `cost${i}`,
      label: "Annual cost",
      kind: "money" as const,
    }));
    const rows = [Object.fromEntries(columns.map((c) => [c.key, "1234567.89"]))];
    const layout = computeFieldTableLayout(columns, rows, 510);

    // Every column still declared, still summing to the table, none of them zero.
    expect(layout.columns).toHaveLength(8);
    expect(layout.columns.reduce((sum, c) => sum + c.widthPct, 0)).toBeCloseTo(100, 1);
    for (const column of layout.columns) expect(column.contentPx).toBeGreaterThan(0);
    // Squeezed below what the whole value needs — which is what the <wbr> break points are for —
    // but never below the widest unbreakable piece of it, "567.89".
    const narrowest = Math.min(...layout.columns.map((c) => c.contentPx));
    expect(narrowest).toBeLessThan(layout.columns[0].valuePx);
    expect(narrowest).toBeGreaterThanOrEqual(narrowestWidthPx("567.89", layout.fontPx));
    // And it reached the smallest type step before giving up any width at all.
    expect(layout.fontPx).toBe(8.5);
  });

  it("declares a width on the first row of every table, which is what fixed layout reads", () => {
    const html = renderReportHtml(poisonedReport());
    // The outer tier table: the status column is a declared 150px and the finding column takes
    // what is left, which under fixed layout is what an auto column gets.
    expect(html).toContain('<th style="width:150px;text-align:right');
    // The appendix.
    expect(html).toContain('<th style="width:30%;text-align:left');
    expect(html).toContain('<th style="width:22%;text-align:left');
    // Every <table> carries an explicit width, or fixed layout has nothing to distribute.
    for (const openTag of html.match(/<table style="[^"]*"/g) ?? []) {
      expect(openTag).toMatch(/width:\s*\d/);
    }
  });

  it("lets a long schema-declared column label wrap rather than holding the table open", () => {
    const html = renderReportHtml(poisonedReport());
    // The <th> opening tag the label sits in, not the label text that follows it.
    const labelAt = html.indexOf("Account owner of record");
    const openingTag = html.slice(html.lastIndexOf("<th", labelAt), labelAt);
    // A 50-character schema-declared label held on one line was half of what pushed this table off
    // the paper. Column labels are consultant-authored strings of any length; they wrap.
    expect(openingTag).not.toContain("white-space:nowrap");
  });

  it("still emits every other finding's columns beside a 600-character token", () => {
    // The original defect: one unbroken token widened the shared tier table past the paper and
    // clipped every OTHER finding's structured columns out of the PDF's text layer entirely.
    // `<wbr>` is zero-width and contributes nothing to the text layer, so it is removed before
    // asking what the page says — the same way pdftotext sees it.
    const text = renderReportHtml(poisonedReport()).replace(/<wbr>/g, "");
    for (const expected of ["Vendor 1", "$176.00", "2027-02-11", "owner@seller.example", "A".repeat(600)]) {
      expect(text).toContain(expected);
    }
  });
});

describe("a status that contradicts its own severity", () => {
  it("names the two genuinely contradictory pairs and nothing else", () => {
    expect(statusContradictsSeverity("PASS", Severity.RED)).toBe(true);
    expect(statusContradictsSeverity("PASS", Severity.YELLOW)).toBe(true);
    expect(statusContradictsSeverity("FAIL", Severity.GREEN)).toBe(true);
    // Unresolved is not the same as contradictory: an item can be blocked AND already known bad.
    expect(statusContradictsSeverity("BLOCKED", Severity.RED)).toBe(false);
    expect(statusContradictsSeverity("IN_PROGRESS", Severity.RED)).toBe(false);
    expect(statusContradictsSeverity("PASS", Severity.GREEN)).toBe(false);
    expect(statusContradictsSeverity("FAIL", Severity.RED)).toBe(false);
    expect(statusContradictsSeverity("PASS", null)).toBe(false);
  });

  function contradictoryReport(): ReportData {
    return report({
      findings: [
        finding({
          id: "ssl",
          tier: Tier.A,
          title: "SSL certificate validity",
          status: "PASS",
          severity: Severity.RED,
          note: "Expires 2029-04-01 (925 days out)",
          templateItem: {
            tier: Tier.A,
            title: "SSL certificate validity",
            description: null,
            method: CheckMethod.AUTOMATED,
          },
        }),
      ],
    });
  }

  it("keeps the severity the roll-up used and states the disagreement in words", () => {
    // The row printed "Pass" beside a Red badge with no explanation. The severity cannot be dropped
    // — every aggregate in the document was computed from it — and the status cannot be hidden, so
    // both are shown and the contradiction is named.
    const html = renderReportHtml(contradictoryReport());
    // The LAST occurrence: the title also appears in the executive summary's risk panel above.
    const row = html.slice(html.lastIndexOf("SSL certificate validity"));
    const cell = row.slice(0, row.indexOf("</tr>"));
    expect(cell).toContain("Pass");
    expect(cell).toContain("Red");
    expect(cell).toContain("Recorded status and rating disagree");
  });

  it("marks the contradiction in the executive summary's risk panel too", () => {
    // This finding is listed under "What drove the rating" while its own note reads benign. Without
    // the marker the entry is unexplainable on the one page some readers open.
    const html = renderReportHtml(contradictoryReport());
    const panel = html.slice(
      html.indexOf("What drove the rating"),
      html.indexOf("How to read the ratings"),
    );
    expect(panel).toContain("recorded status: Pass");
    expect(panel).toContain("disagrees with this rating");
  });

  it("says nothing on a finding whose status and severity agree", () => {
    const html = renderReportHtml(
      report({ findings: [finding({ status: "FAIL", severity: Severity.RED })] }),
    );
    expect(html).not.toContain("Recorded status and rating disagree");
    expect(html).not.toContain("recorded status:");
  });
});

describe("a brand colour too pale to draw structure with", () => {
  /**
   * Real firm brand hexes, with the contrast each one has against the white page beside it.
   *
   * The previous version of this test pinned three colours — #0d7a6f, #0f172a, #b91c1c — all of
   * them dark, all of them clearing 3:1 with room to spare, and none of them anywhere near the
   * range where the function's behaviour actually changes. It therefore passed while six of the
   * colours below were being silently restyled. The mid-tones are the point: every entry marked
   * "below 3:1" is a colour the WCAG non-text bar rejects and a consultant would nonetheless
   * recognise instantly as their own.
   */
  const BRAND_ACCENTS: [string, string][] = [
    ["#ffe600", "EY yellow — 1.27:1, below 3:1"],
    ["#86bc25", "Deloitte green — 2.24:1, below 3:1"],
    ["#f38020", "Cloudflare orange — 2.65:1, below 3:1"],
    ["#ff7a59", "HubSpot coral — 2.58:1, below 3:1"],
    ["#95bf47", "Shopify green — 2.40:1, below 3:1"],
    ["#00a1e0", "Salesforce blue — 2.94:1, just below 3:1"],
    ["#0d7a6f", "teal — clears 3:1"],
    ["#0f172a", "near-black slate — clears 3:1"],
    ["#b91c1c", "deep red — clears 3:1"],
    ["#00338d", "KPMG blue — clears 3:1"],
    ["#eb1700", "PwC red-orange — clears 3:1"],
    ["#7f56d9", "violet — clears 3:1"],
  ];

  it.each(BRAND_ACCENTS)("uses %s (%s) exactly as the firm chose it", (hex) => {
    // spec.md §2 principle 4: whitelabel by default. Clamping a saturated brand to WCAG's
    // luminance-only 3:1 bar turned EY's yellow into #a69600 olive across an entire deliverable —
    // a category of real firms restyled, not an edge case. A colour with real chroma in it is
    // visible on paper because of its hue; the ratio simply does not model that.
    expect(structuralAccent(hex)).toBe(hex);
  });

  it("changes nothing across a whole sample of real brand colours", () => {
    // The claim the docstring makes, asserted as a claim rather than spot-checked: nothing in this
    // set moves at all.
    const moved = BRAND_ACCENTS.map(([hex]) => hex).filter((hex) => structuralAccent(hex) !== hex);
    expect(moved).toEqual([]);
  });

  it("still clamps the near-greys, where luminance is all there is to be seen by", () => {
    // A tint of the paper has no hue to carry it and is where WCAG's ratio is exactly the right
    // instrument. These are the colours the clamp was built for and they still move.
    for (const [pale, contrast] of [
      ["#ffffff", 1.0],
      ["#f8fafc", 1.05],
      ["#e2e8f0", 1.25],
      ["#fff3c4", 1.12],
      ["#c8ccd0", 1.6],
    ] as [string, number][]) {
      expect(contrast).toBeLessThan(3);
      expect(structuralAccent(pale)).not.toBe(pale);
    }
  });

  it("puts the line between a colour and a tint of the paper where brands actually sit", () => {
    // #ffe600 (1.27:1) and #e2e8f0 (1.25:1) are indistinguishable to the contrast formula and
    // nothing alike on paper. Chroma is what separates them, and the two cases have to land on
    // opposite sides of it or the fix is arbitrary.
    expect(structuralAccent("#ffe600")).toBe("#ffe600");
    expect(structuralAccent("#e2e8f0")).not.toBe("#e2e8f0");
    // A pale gold wash is a tint, not a brand colour, even though it has a hue: it is clamped, and
    // the test below checks it keeps that hue on the way.
    expect(structuralAccent("#fff3c4")).not.toBe("#fff3c4");
  });

  it("darkens an accent that cannot be seen against the page, keeping its hue", () => {
    const white = structuralAccent("#ffffff");
    expect(white).not.toBe("#ffffff");
    // Neutral in, neutral out.
    expect(white.slice(1, 3)).toBe(white.slice(3, 5));
    expect(white.slice(3, 5)).toBe(white.slice(5, 7));

    // A pale gold stays gold rather than becoming grey.
    const gold = structuralAccent("#fff3c4");
    expect(parseInt(gold.slice(1, 3), 16)).toBeGreaterThan(parseInt(gold.slice(5, 7), 16));
  });

  it("clamps to WCAG's 3:1 non-text contrast bar against white, and no further", () => {
    const luminance = (hex: string): number => {
      const channel = (start: number): number => {
        const v = parseInt(hex.slice(start, start + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    for (const pale of ["#ffffff", "#fff3c4", "#f8fafc", "#e2e8f0"]) {
      const clamped = structuralAccent(pale);
      expect(1.05 / (luminance(clamped) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses the muted slate for accent-coloured text an accent is too pale to carry", () => {
    // Text needs 4.5:1, which many perfectly good brand accents miss — falling back beats darkening
    // the brand into something the firm did not pick.
    expect(pageTextAccent("#0d7a6f")).toBe("#0d7a6f");
    expect(pageTextAccent("#ffffff")).toBe("#64748b");
    expect(pageTextAccent(structuralAccent("#ffffff"))).toBe("#64748b");
  });

  it("renders a structured document for a white-branded firm", () => {
    // Observed: brandColorHex "#ffffff" produced a cover band, section rules, table-header fills and
    // running header/footer rules that were all white on white. Text stayed legible, so nothing
    // looked broken — the deliverable had simply lost every boundary a reader navigates by.
    const html = renderReportHtml(
      report({
        org: { name: "Whitehall Advisory", brandColorHex: "#ffffff", brandLogoDataUri: null },
        findings: [finding({ severity: Severity.RED, status: "FAIL" })],
      }),
    );
    expect(html).not.toContain("solid #ffffff");
    expect(html).not.toContain("background:#ffffff;color:");
    expect(html).not.toContain("rgba(255,255,255,");
    // And a normally-branded firm's document is untouched.
    expect(renderReportHtml(report({ findings: [finding({})] }))).toContain("solid #0d7a6f");
  });
});

describe("the executive summary's risk list represents every tier", () => {
  function twentyPerTier(): ReportFinding[] {
    const findings: ReportFinding[] = [];
    for (const tier of [Tier.A, Tier.B, Tier.C]) {
      for (let i = 0; i < 20; i++) {
        findings.push(
          finding({
            id: `${tier}${i}`,
            tier,
            title: `${tier} red item ${i + 1}`,
            status: "FAIL",
            severity: Severity.RED,
            templateItem: { tier, title: `${tier} red item ${i + 1}`, description: null },
          }),
        );
      }
    }
    return findings;
  }

  it("does not let one tier fill the whole panel", () => {
    // Observed: with 20 Reds in each tier the panel listed eight Tier A items and "+ 52 further Red
    // items in the detail section" — Tier B and C, where the material findings in a deal live,
    // never reached the one page some readers open.
    const tiers = topRiskFindings(twentyPerTier(), 8).map((f) => f.templateItem.tier);
    expect(new Set(tiers)).toEqual(new Set([Tier.A, Tier.B, Tier.C]));
    // Round-robin: nobody gets a second slot before every tier has had a first.
    expect(tiers.filter((t) => t === Tier.A)).toHaveLength(3);
    expect(tiers.filter((t) => t === Tier.B)).toHaveLength(3);
    expect(tiers.filter((t) => t === Tier.C)).toHaveLength(2);
  });

  it("keeps the panel in tier order for reading", () => {
    const order = { A: 0, B: 1, C: 2 } as const;
    const tiers = topRiskFindings(twentyPerTier(), 8).map((f) => order[f.templateItem.tier]);
    expect([...tiers].sort()).toEqual(tiers);
  });

  it("names items from every tier in the rendered summary panel", () => {
    const html = renderReportHtml(report({ findings: twentyPerTier() }));
    const panel = html.slice(
      html.indexOf("What drove the rating"),
      html.indexOf("How to read the ratings"),
    );
    expect(panel).toContain("A red item 1");
    expect(panel).toContain("B red item 1");
    expect(panel).toContain("C red item 1");
    expect(panel).toContain("+ 52 further Red items");
  });

  it("degrades to plain order when only one tier has Reds", () => {
    const only = Array.from({ length: 5 }, (_, i) =>
      finding({ id: `a${i}`, tier: Tier.A, title: `A ${i}`, severity: Severity.RED, status: "FAIL" }),
    );
    expect(topRiskFindings(only, 8).map((f) => f.templateItem.title)).toEqual([
      "A 0",
      "A 1",
      "A 2",
      "A 3",
      "A 4",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The same document, measured in a real layout engine.
//
// Everything above reasons about the widths the HTML declares. This runs the document through the
// engine that actually produces the PDF and measures where the glyphs land — which is the only way
// to catch the class of defect that started this file: a cell drawn on top of its neighbour is
// invisible to every string assertion, because both strings are present and correct.
//
// The unit suite has to stay runnable on a machine with no browser binary (see
// vitest.config.mts), and `npx playwright install` does not work in every sandbox — so these skip
// rather than fail when no browser can be found, with the declared-width suite above still
// covering the same invariants one level up.
//
// But the browser is resolved from an INSTALLED playwright as well as from the environment
// variable. Gating on the variable alone meant these skipped everywhere it wasn't set — including
// CI, which runs `npm test` in a job that never sets it — so the assertions were reported as
// passing while measuring nothing. A suite that skips silently is indistinguishable from one that
// passes, which is the failure this file exists to stop shipping.
// ---------------------------------------------------------------------------

/**
 * A usable Chromium: the explicit override if it points at something real, otherwise whatever
 * `playwright install` put on this machine. Undefined only when there genuinely isn't one.
 */
function resolveChromium(): string | undefined {
  const override = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (override && existsSync(override)) return override;
  try {
    // Resolved synchronously so it can gate `describe.skipIf` at collection time; playwright
    // itself is imported dynamically further down, after the gate has already decided.
    const { chromium } = createRequire(import.meta.url)("playwright");
    const installed = chromium.executablePath();
    if (installed && existsSync(installed)) return installed;
  } catch {
    // playwright throws when no browser is registered for this platform; treat as "none".
  }
  return undefined;
}

const CHROMIUM_PATH = resolveChromium();

/**
 * Measured in the page, as a string rather than a function: vitest compiles this file with esbuild,
 * which rewrites every function literal to reference a `__name` helper that does not exist inside
 * the browser context.
 *
 * Returns, for the whole document: cells whose text is painted outside their own content box (the
 * overprinting defect), words broken across lines inside a table header, values in an atomic
 * column that had to wrap at all, and the text layer as the page presents it.
 */
const MEASURE = `(() => {
  const overflowing = [];
  const splitHeaderWords = [];
  const wrappedAtomicValues = [];
  const ATOMIC = /^(-?\\$[\\d,.]+|\\d{4}-\\d{2}-\\d{2}|[\\d.]+%)$/;

  for (const cell of document.querySelectorAll("td,th")) {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const rects = [...range.getClientRects()];
    if (rects.length === 0) continue;

    const box = cell.getBoundingClientRect();
    const style = getComputedStyle(cell);
    // Every table in this document sets border-collapse: collapse, and a collapsed border is drawn
    // half inside the cell box and half outside it — so only half of it comes off the content box.
    // Counting the whole of the 4px severity rail reports a 2px underflow on a cell that is fine.
    const half = getComputedStyle(cell.closest("table")).borderCollapse === "collapse" ? 0.5 : 1;
    const right = box.right - parseFloat(style.paddingRight) - half * parseFloat(style.borderRightWidth);
    const left = box.left + parseFloat(style.paddingLeft) + half * parseFloat(style.borderLeftWidth);
    const over = Math.max(...rects.map((r) => r.right)) - right;
    const under = left - Math.min(...rects.map((r) => r.left));
    const text = (cell.textContent || "").trim();
    if (over > 1 || under > 1) {
      overflowing.push(text.slice(0, 40) + " [+" + Math.max(over, under).toFixed(1) + "px]");
    }

    // Lines, not rects: a value carrying <wbr> break opportunities is several text nodes and so
    // several rects even when it sits on one line, sometimes a fraction of a pixel apart. A real
    // second line is a whole line-height away.
    const tops = rects.map((r) => r.top);
    if (ATOMIC.test(text) && Math.max(...tops) - Math.min(...tops) > 3) wrappedAtomicValues.push(text);
    if (cell.tagName !== "TH") continue;

    // A header word split across two lines shows up as a word-range with two client rects.
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      const words = /[^\\s]+/g;
      let match;
      while ((match = words.exec(value))) {
        if (match[0].length < 2) continue;
        const wordRange = document.createRange();
        wordRange.setStart(node, match.index);
        wordRange.setEnd(node, match.index + match[0].length);
        if (wordRange.getClientRects().length > 1) splitHeaderWords.push(match[0]);
      }
    }
  }

  const fieldTable = [...document.querySelectorAll("table")].find(
    (t) => t.style.marginTop === "4px" && t.querySelector("thead")
  );

  return {
    overflowing,
    splitHeaderWords: [...new Set(splitHeaderWords)],
    wrappedAtomicValues: [...new Set(wrappedAtomicValues)],
    fieldTableWidth: fieldTable ? +fieldTable.getBoundingClientRect().width.toFixed(1) : null,
    text: document.body.innerText,
  };
})()`;

describe.skipIf(!CHROMIUM_PATH)("the document as Chromium actually lays it out", () => {
  // A type-only reference: it costs nothing at runtime, so the package is still loaded lazily in
  // beforeAll and a unit run with no browser never touches it.
  let browser: Awaited<ReturnType<typeof import("playwright").chromium.launch>>;

  beforeAll(async () => {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function measure(html: string) {
    const page = await browser.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      // A4 (210mm) less pdf.ts's 14mm margins, at 96dpi — the width the document is paginated at.
      await page.setViewportSize({ width: 688, height: 1400 });
      await page.setContent(html, { waitUntil: "load" });
      return (await page.evaluate(MEASURE)) as {
        overflowing: string[];
        splitHeaderWords: string[];
        wrappedAtomicValues: string[];
        fieldTableWidth: number | null;
        text: string;
      };
    } finally {
      await page.close();
    }
  }

  it("confirms the width a structured table is laid out in", async () => {
    // FIELD_TABLE_PX above is arithmetic from the A4 page box; this is the number itself.
    const measured = await measure(renderReportHtml(registerReport(FOUR_COLUMNS)));
    expect(measured.fieldTableWidth).toBeGreaterThan(504);
    expect(measured.fieldTableWidth).toBeLessThan(516);
  }, 60_000);

  it.each(REGISTER_SHAPES)("paints no cell of a %s-column register over its neighbour", async (_shape, columns) => {
    // The defect itself, measured where it happens. Before the column sizing this reported every
    // money and date cell in the six- and eight-column registers, overflowing by 20-42px each.
    const measured = await measure(renderReportHtml(registerReport(columns)));
    expect(measured.overflowing).toEqual([]);
  }, 60_000);

  it.each(REGISTER_SHAPES)("breaks no column label of a %s-column register mid-word", async (_shape, columns) => {
    // "MONT"/"HLY COST" and "ANNU"/"AL COST", read off a rendered page.
    const measured = await measure(renderReportHtml(registerReport(columns)));
    expect(measured.splitHeaderWords).toEqual([]);
  }, 60_000);

  it.each(REGISTER_SHAPES.slice(0, 2))(
    "puts every money and date value of a %s-column register on one line",
    async (_shape, columns) => {
      const measured = await measure(renderReportHtml(registerReport(columns)));
      expect(measured.wrappedAtomicValues).toEqual([]);
    },
    60_000,
  );

  it("keeps every value in the text layer, including beside a 600-character token", async () => {
    // What `table-layout: fixed` was bought for, and what none of the above may trade away: the
    // original defect clipped other findings' columns out of the PDF's text layer entirely.
    const measured = await measure(renderReportHtml(poisonedReport()));
    for (const expected of ["Vendor 1", "$176.00", "2027-02-11", "owner@seller.example"]) {
      expect(measured.text).toContain(expected);
    }
    expect(measured.text).toContain("A".repeat(60));
  }, 60_000);

  it("draws a bright brand accent as the firm's own colour", async () => {
    // #ffe600 came back #a69600 and printed an olive-gold document. The accent reaches the page
    // unchanged now, and the text on top of it still flips to dark — which is what makes that safe.
    const html = renderReportHtml(
      report({
        org: { name: "Yellow Brand LLP", brandColorHex: "#ffe600", brandLogoDataUri: null },
        findings: [finding({ severity: Severity.RED, status: "FAIL" })],
      }),
    );
    expect(html).toContain("background:#ffe600");
    expect(html).not.toContain("#a69600");
    const measured = await measure(html);
    expect(measured.overflowing).toEqual([]);
  }, 60_000);
});
