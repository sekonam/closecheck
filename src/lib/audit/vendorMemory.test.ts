import { describe, expect, it } from "vitest";

import type { ItemFieldSchema } from "@/lib/templates/fieldSchema";

import { isWorthRemembering, recallFields, vendorKeyFor, vendorLabelFor } from "./vendorMemory";

const CONTRACT_SCHEMA: ItemFieldSchema = {
  fields: [
    { key: "vendor", label: "Vendor / system", kind: "text" },
    { key: "transferable", label: "Transfers to the buyer", kind: "enum", options: ["transfers", "does-not-transfer"] },
    { key: "penaltyAmount", label: "Early-termination penalty", kind: "money" },
    { key: "tools", label: "Tools", kind: "table", columns: [{ key: "tool", label: "Tool", kind: "text" }] },
  ],
};

const identity = (_key: string, value: string) => value;

describe("vendorLabelFor", () => {
  it("reads the vendor from whichever identity field the item declares", () => {
    expect(vendorLabelFor(CONTRACT_SCHEMA, { vendor: "Toast" })).toBe("Toast");
    const gatewaySchema: ItemFieldSchema = {
      fields: [{ key: "gateway", label: "Gateway", kind: "text" }],
    };
    expect(vendorLabelFor(gatewaySchema, { gateway: "Stripe" })).toBe("Stripe");
  });

  it("returns null for an item that names no vendor", () => {
    // These items simply have no memory, which is the right degradation — nothing breaks.
    const schema: ItemFieldSchema = { fields: [{ key: "observation", label: "Notes", kind: "longtext" }] };
    expect(vendorLabelFor(schema, { observation: "x" })).toBeNull();
  });

  it("ignores an identity field the schema does not declare", () => {
    // Stops a stale value left in structuredData by an older template version from naming a vendor
    // the current item never asked about.
    expect(vendorLabelFor(CONTRACT_SCHEMA, { platform: "Square" })).toBeNull();
  });

  it("treats a blank or whitespace vendor as absent", () => {
    expect(vendorLabelFor(CONTRACT_SCHEMA, { vendor: "   " })).toBeNull();
  });
});

describe("vendorKeyFor", () => {
  it("treats the spellings one consultant uses for one vendor as the same vendor", () => {
    const expected = vendorKeyFor("Toast");
    for (const spelling of ["toast", "Toast POS", "Toast, Inc.", "TOAST Systems", "  Toast  "]) {
      expect(vendorKeyFor(spelling), spelling).toBe(expected);
    }
  });

  it("keeps genuinely different vendors apart", () => {
    // Conservative on purpose: two profiles for one vendor is a smaller failure than showing a
    // consultant terms from a different company's contract.
    expect(vendorKeyFor("Toast")).not.toBe(vendorKeyFor("Square"));
    expect(vendorKeyFor("Square")).not.toBe(vendorKeyFor("Squarespace"));
    expect(vendorKeyFor("Clover")).not.toBe(vendorKeyFor("Cloverleaf"));
  });

  it("does not collapse a name to nothing", () => {
    // A vendor literally called "Systems Inc" would key to empty under naive stripping, and every
    // such vendor would then merge into one profile.
    expect(vendorKeyFor("Payments Inc")).not.toBe("");
  });
});

describe("recallFields", () => {
  const memory = {
    vendorLabel: "Toast",
    sourceBusinessName: "Harbour Street Bistro",
    recordedAt: new Date("2026-04-02T00:00:00Z"),
    values: { vendor: "Toast", transferable: "does-not-transfer", penaltyAmount: "4800" },
  };

  it("recalls the facts about the vendor, not the vendor's own name", () => {
    const recalled = recallFields(CONTRACT_SCHEMA, memory, {}, identity);
    expect(recalled.map((f) => f.label)).toEqual([
      "Transfers to the buyer",
      "Early-termination penalty",
    ]);
  });

  it("never recalls a table", () => {
    // A SaaS inventory is a per-deal list, not a vendor characteristic — recalling one would
    // suggest the last client's tools belong to this one.
    const withTable = { ...memory, values: { ...memory.values, tools: [{ tool: "Mailchimp" }] } };
    expect(recallFields(CONTRACT_SCHEMA, withTable as never, {}, identity).some((f) => f.label === "Tools")).toBe(
      false,
    );
  });

  it("flags where this deal's answer differs from last time", () => {
    // Divergence is the finding: either the contract was negotiated differently, or one of the two
    // readings is wrong. Both are things the consultant needs to see.
    const recalled = recallFields(CONTRACT_SCHEMA, memory, { transferable: "transfers" }, identity);
    expect(recalled.find((f) => f.label === "Transfers to the buyer")?.differs).toBe(true);
    expect(recalled.find((f) => f.label === "Early-termination penalty")?.differs).toBe(false);
  });

  it("does not call an unanswered field a divergence", () => {
    // Before the consultant has answered, there is nothing to differ from.
    const recalled = recallFields(CONTRACT_SCHEMA, memory, {}, identity);
    expect(recalled.every((f) => !f.differs)).toBe(true);
  });

  it("formats values the way the live fields do", () => {
    const recalled = recallFields(CONTRACT_SCHEMA, memory, {}, (key, value) =>
      key === "penaltyAmount" ? `$${value}` : value,
    );
    expect(recalled.find((f) => f.label === "Early-termination penalty")?.value).toBe("$4800");
  });

  it("skips fields the remembered profile has no value for", () => {
    const sparse = { ...memory, values: { vendor: "Toast" } };
    expect(recallFields(CONTRACT_SCHEMA, sparse, {}, identity)).toEqual([]);
  });
});

describe("isWorthRemembering", () => {
  it("remembers a vendor with facts attached", () => {
    expect(isWorthRemembering(CONTRACT_SCHEMA, { vendor: "Toast", transferable: "transfers" })).toBe(true);
  });

  it("does not remember a vendor name on its own", () => {
    // A profile holding nothing but a name makes the panel look broken rather than empty.
    expect(isWorthRemembering(CONTRACT_SCHEMA, { vendor: "Toast" })).toBe(false);
  });

  it("does not remember facts with no vendor to attach them to", () => {
    expect(isWorthRemembering(CONTRACT_SCHEMA, { transferable: "transfers" })).toBe(false);
  });
});
