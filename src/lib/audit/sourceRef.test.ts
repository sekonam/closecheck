import { describe, expect, it } from "vitest";

import {
  citationsByField,
  formatCitation,
  parseSourceRef,
  withFieldCitation,
  type Citation,
} from "./sourceRef";

const CONTRACT = {
  id: "ev1",
  text: "toast-msa-2023.pdf",
  label: null as string | null,
  sourceRef: {
    citations: [
      { fieldKey: "transferable", locator: "§14.2, p.7", excerpt: "This Agreement may not be assigned" },
      { fieldKey: "penaltyAmount", locator: "§9.1" },
    ],
  } as unknown,
};

describe("parseSourceRef", () => {
  it("reads well-formed citations", () => {
    expect(parseSourceRef(CONTRACT.sourceRef)).toHaveLength(2);
  });

  it("fails closed on anything malformed rather than throwing", () => {
    // A consultant must not lose a whole audit page because one row is corrupt.
    expect(parseSourceRef(null)).toEqual([]);
    expect(parseSourceRef("garbage")).toEqual([]);
    expect(parseSourceRef({ citations: "nope" })).toEqual([]);
    expect(parseSourceRef({ citations: [{ noFieldKey: true }] })).toEqual([]);
  });
});

describe("citationsByField", () => {
  it("groups one document's citations under the fields they substantiate", () => {
    // The relationship is one document to many claims: an executed contract answers
    // transferability from its assignment clause and the penalty from another.
    const byField = citationsByField([CONTRACT], new Set(["transferable", "penaltyAmount"]));
    expect(byField.get("transferable")?.[0].excerpt).toMatch(/may not be assigned/);
    expect(byField.get("penaltyAmount")?.[0].locator).toBe("§9.1");
  });

  it("drops citations for fields the schema no longer declares", () => {
    // A report generated today may render a finding whose template version has since changed.
    // Rendering a citation attached to nothing would be worse than dropping it.
    const byField = citationsByField([CONTRACT], new Set(["transferable"]));
    expect(byField.has("penaltyAmount")).toBe(false);
  });

  it("names the document by the consultant's label when there is one", () => {
    const byField = citationsByField(
      [{ ...CONTRACT, label: "Toast MSA, executed" }],
      new Set(["transferable"]),
    );
    expect(byField.get("transferable")?.[0].documentName).toBe("Toast MSA, executed");
  });

  it("falls back to the filename, then to a generic word", () => {
    expect(
      citationsByField([CONTRACT], new Set(["transferable"])).get("transferable")?.[0].documentName,
    ).toBe("toast-msa-2023.pdf");
    expect(
      citationsByField([{ ...CONTRACT, text: null }], new Set(["transferable"])).get("transferable")?.[0]
        .documentName,
    ).toBe("document");
  });

  it("collects citations for one field across several documents", () => {
    const second = { ...CONTRACT, id: "ev2", text: "amendment-1.pdf", sourceRef: { citations: [{ fieldKey: "transferable", locator: "§2" }] } };
    const byField = citationsByField([CONTRACT, second], new Set(["transferable"]));
    expect(byField.get("transferable")).toHaveLength(2);
  });
});

describe("formatCitation", () => {
  const base = { fieldKey: "transferable", evidenceId: "ev1", documentName: "toast-msa.pdf" };

  it("reads as a lawyer would write it: where, in what, saying what", () => {
    expect(formatCitation({ ...base, locator: "§14.2, p.7", excerpt: "may not be assigned" })).toBe(
      "§14.2, p.7 of toast-msa.pdf: “may not be assigned”",
    );
  });

  it("drops the locator when there isn't one", () => {
    expect(formatCitation({ ...base, excerpt: "may not be assigned" })).toBe(
      "toast-msa.pdf: “may not be assigned”",
    );
  });

  it("is still useful with only a locator", () => {
    expect(formatCitation({ ...base, locator: "§14.2" })).toBe("§14.2 of toast-msa.pdf");
  });
});

describe("withFieldCitation", () => {
  const existing: Citation[] = [
    { fieldKey: "transferable", locator: "§14.2" },
    { fieldKey: "penaltyAmount", locator: "§9.1" },
  ];

  it("replaces one field's citation without disturbing the others", () => {
    // Correcting the transferability citation must not silently drop the penalty citation on the
    // same contract — they were recorded weeks apart and losing the older one would be invisible.
    const result = withFieldCitation(existing, "transferable", { locator: "§14.3" });
    expect(result.citations).toHaveLength(2);
    expect(result.citations.find((c) => c.fieldKey === "transferable")?.locator).toBe("§14.3");
    expect(result.citations.find((c) => c.fieldKey === "penaltyAmount")?.locator).toBe("§9.1");
  });

  it("removes the citation when both fields are cleared", () => {
    expect(withFieldCitation(existing, "transferable", { locator: "", excerpt: "  " }).citations).toEqual([
      { fieldKey: "penaltyAmount", locator: "§9.1" },
    ]);
    expect(withFieldCitation(existing, "transferable", null).citations).toHaveLength(1);
  });

  it("keeps a citation that has an excerpt but no locator", () => {
    const result = withFieldCitation([], "transferable", { excerpt: "may not be assigned" });
    expect(result.citations[0]).toEqual({ fieldKey: "transferable", excerpt: "may not be assigned" });
  });

  it("trims whitespace rather than storing it", () => {
    const result = withFieldCitation([], "transferable", { locator: "  §14.2  ", excerpt: "  x  " });
    expect(result.citations[0]).toEqual({ fieldKey: "transferable", locator: "§14.2", excerpt: "x" });
  });
});
