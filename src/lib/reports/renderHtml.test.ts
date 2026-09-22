import { describe, expect, it } from "vitest";
import { CheckMethod, Severity, Tier } from "@prisma/client";
import {
  accentWash,
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

describe("table width can never push content off the paper", () => {
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

  it("breaks a long unbroken token instead of letting it size the table", () => {
    // overflow-wrap:anywhere and NOT break-word: only `anywhere` reduces min-content width, which
    // is the number auto table layout sizes columns from. break-word alone leaves the defect.
    expect(renderReportHtml(poisonedReport())).toContain("overflow-wrap: anywhere");
  });

  it("fixes every table's layout so no cell content can widen it", () => {
    expect(renderReportHtml(poisonedReport())).toContain("table-layout: fixed");
  });

  it("declares a width on the first row of every table, which is what fixed layout reads", () => {
    const html = renderReportHtml(poisonedReport());
    // The outer tier table.
    expect(html).toContain('<th style="width:72%;text-align:left');
    expect(html).toContain('<th style="width:28%;text-align:right');
    // The structured table inside it: 2 text columns + 2 atomic ones, weighted 2:2:1:1.
    expect(html).toContain('<th style="width:33.33%;text-align:left');
    expect(html).toContain('<th style="width:16.67%;text-align:right');
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

  // Passes before the fix as well as after, deliberately: it guards the EARLIER deliberate fix
  // (a term end must never print as "2027-02-" / "11") against the new wrapping rules, rather than
  // the defect above. nowrap removes every soft wrap opportunity, so overflow-wrap cannot reach
  // these cells.
  it("still keeps money, percent and date cells atomic", () => {
    const html = renderReportHtml(poisonedReport());
    expect(html).toContain("white-space:nowrap;padding:4px 8px");
    const cell = html.slice(html.indexOf("2027-02-11") - 200, html.indexOf("2027-02-11"));
    expect(cell).toContain("white-space:nowrap");
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
  it("leaves a brand colour that is already visible on paper exactly as chosen", () => {
    // The consultant's own colour is never second-guessed where it does no harm.
    expect(structuralAccent("#0d7a6f")).toBe("#0d7a6f");
    expect(structuralAccent("#0f172a")).toBe("#0f172a");
    expect(structuralAccent("#b91c1c")).toBe("#b91c1c");
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
