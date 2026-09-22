import { CheckMethod, Severity, Tier } from "@prisma/client";

import type { ReportData, ReportFinding } from "@/lib/reports/renderHtml";

/**
 * Structured-table fixtures for the report renderer, shared by two suites in different lanes.
 *
 * The unit suite beside renderHtml.ts asserts the column widths the HTML declares; the integration
 * suite lays the same document out in Chromium and measures where the glyphs actually land. Both
 * have to describe the same registers — a four-, six- and eight-column vendor table carrying the
 * widest value each kind plausibly reaches — or the two stop testing the same thing and the
 * declared widths can drift away from the measured ones without either suite noticing.
 *
 * Not a `.test.ts`, so the unit suite's default include glob leaves it alone.
 */

/** Minimal builders, duplicated from the unit suite's local ones on purpose — a fixture module
 * that imported test-local helpers would couple the two lanes in the direction this avoids. */
export function finding(over: Partial<ReportFinding> & { tier?: Tier; title?: string }): ReportFinding {
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

export function report(over: Partial<ReportData> = {}): ReportData {
  return {
    businessName: "Harbour Street Bistro",
    templateName: "Restaurant — v4",
    generatedAt: new Date("2026-09-22T10:00:00Z"),
    org: { name: "Meridian Diligence", brandColorHex: "#0d7a6f", brandLogoDataUri: null },
    findings: [],
    ...over,
  } as ReportData;
}

export interface Col {
  key: string;
  label: string;
  kind: string;
}

export const FOUR_COLUMNS: Col[] = [
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "monthlyCost", label: "Monthly cost", kind: "money" },
  { key: "termEnd", label: "Term end", kind: "date" },
  { key: "owner", label: "Account owner of record at the seller organisation", kind: "text" },
];

export const SIX_COLUMNS: Col[] = [
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "monthlyCost", label: "Monthly cost", kind: "money" },
  { key: "annualCost", label: "Annual cost", kind: "money" },
  { key: "termEnd", label: "Term end", kind: "date" },
  { key: "assignment", label: "Assignment on change of control", kind: "text" },
  { key: "owner", label: "Account owner of record at the seller organisation", kind: "text" },
];

export const EIGHT_COLUMNS: Col[] = [
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "monthlyCost", label: "Monthly cost", kind: "money" },
  { key: "annualCost", label: "Annual cost", kind: "money" },
  { key: "setupFee", label: "Setup fee", kind: "money" },
  { key: "uplift", label: "Renewal uplift", kind: "percent" },
  { key: "termEnd", label: "Term end", kind: "date" },
  { key: "renewsOn", label: "Renews on", kind: "date" },
  { key: "owner", label: "Account owner", kind: "text" },
];

export const REGISTER_SHAPES: [string, Col[]][] = [
  ["four", FOUR_COLUMNS],
  ["six", SIX_COLUMNS],
  ["eight", EIGHT_COLUMNS],
];

/** Rows carrying the widest value each kind plausibly reaches: a seven-figure amount, a full ISO
 * date, and a vendor name with no break opportunity anywhere in it. */
export function registerRows(columns: Col[]): Record<string, string>[] {
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

export function registerReport(columns: Col[]): ReportData {
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

// The defect, reproduced against a real PDF: one 600-character unbroken token in ONE finding's
// note widened the shared tier table past A4, and every OTHER finding's structured columns were
// clipped off the right edge — absent from the PDF's text layer, not merely overflowing it.
export const saasSchema = {
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

export function poisonedReport(): ReportData {
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
