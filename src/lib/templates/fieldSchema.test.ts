import { describe, expect, it } from "vitest";

import {
  assertValidFieldSchema,
  fieldInputName,
  formatFieldValue,
  normalizeMoney,
  parseFieldSchema,
  readFieldValues,
  readPersistedValues,
  tableInputName,
  type ItemFieldSchema,
} from "./fieldSchema";

const contractSchema: ItemFieldSchema = {
  fields: [
    { key: "transferable", label: "Transferable", kind: "enum", options: ["yes", "no", "unclear"] },
    { key: "penaltyAmount", label: "Early-termination penalty", kind: "money" },
    { key: "penaltyBasis", label: "Penalty basis", kind: "text" },
  ],
};

const tableSchema: ItemFieldSchema = {
  fields: [
    {
      key: "tools",
      label: "SaaS tools",
      kind: "table",
      columns: [
        { key: "tool", label: "Tool", kind: "text" },
        { key: "monthlyCost", label: "Monthly cost", kind: "money" },
        { key: "transfers", label: "Transfers", kind: "enum", options: ["transfers", "rebuild", "unclear"] },
      ],
    },
  ],
};

/** Build a `read` function over a plain object, mimicking FormData.get's null-for-absent. */
function reader(posted: Record<string, string>) {
  // A Map, because that is what production builds (src/lib/actions/audits.ts materialises the
  // FormData entries into one). A plain object here made the helper simulate something the product
  // does not do: a field named `constructor` would have resolved through Object.prototype in the
  // test and not in the app.
  const entries = new Map(Object.entries(posted));
  return (name: string) => entries.get(name) ?? null;
}

describe("schema validation", () => {
  it("accepts a well-formed schema", () => {
    expect(parseFieldSchema(contractSchema)).toEqual(contractSchema);
  });

  it("rejects an enum field with no options", () => {
    expect(() =>
      assertValidFieldSchema({ fields: [{ key: "a", label: "A", kind: "enum" }] }, "test"),
    ).toThrow(/needs options/);
  });

  it("rejects a table field with no columns", () => {
    expect(() =>
      assertValidFieldSchema({ fields: [{ key: "a", label: "A", kind: "table" }] }, "test"),
    ).toThrow(/needs columns/);
  });

  it("rejects duplicate field keys", () => {
    expect(() =>
      assertValidFieldSchema(
        { fields: [{ key: "a", label: "A", kind: "text" }, { key: "a", label: "B", kind: "text" }] },
        "test",
      ),
    ).toThrow(/duplicate field key/);
  });

  it("rejects options on a non-enum field", () => {
    expect(() =>
      assertValidFieldSchema({ fields: [{ key: "a", label: "A", kind: "text", options: ["x", "y"] }] }, "test"),
    ).toThrow(/only valid on enum/);
  });

  it("fails closed on malformed persisted JSON rather than throwing", () => {
    // A consultant mid-engagement must not get a 500 because one template row is corrupt.
    expect(parseFieldSchema({ fields: "nope" })).toBeNull();
    expect(parseFieldSchema(null)).toBeNull();
    expect(parseFieldSchema("garbage")).toBeNull();
  });
});

describe("money normalisation", () => {
  it("canonicalises the forms a consultant actually types", () => {
    expect(normalizeMoney("$12,000")).toBe("12000");
    expect(normalizeMoney("12000")).toBe("12000");
    expect(normalizeMoney("12,000.50")).toBe("12000.50");
    expect(normalizeMoney(" $1,234.56 ")).toBe("1234.56");
  });

  it("rejects free text so two audits stay comparable", () => {
    // "3 months' fees" is a *basis*, not an amount — items that need it declare a text field.
    expect(normalizeMoney("3 months' fees")).toBeNull();
    expect(normalizeMoney("about 5k")).toBeNull();
    expect(normalizeMoney("12.345")).toBeNull();
  });

  it("treats blank as cleared, not invalid", () => {
    expect(normalizeMoney("")).toBe("");
  });
});

describe("reading submitted values", () => {
  it("reads scalars and normalises them", () => {
    const result = readFieldValues(
      contractSchema,
      reader({
        [fieldInputName("transferable")]: "no",
        [fieldInputName("penaltyAmount")]: "$12,000",
        [fieldInputName("penaltyBasis")]: "  flat fee  ",
      }),
    );
    expect(result).toEqual({
      ok: true,
      values: { transferable: "no", penaltyAmount: "12000", penaltyBasis: "flat fee" },
    });
  });

  it("omits blank values instead of storing empty strings", () => {
    const result = readFieldValues(
      contractSchema,
      reader({
        [fieldInputName("transferable")]: "",
        [fieldInputName("penaltyAmount")]: "",
        [fieldInputName("penaltyBasis")]: "",
      }),
    );
    expect(result).toEqual({ ok: true, values: {} });
  });

  it("ignores keys the schema does not declare", () => {
    // The schema is the allowlist: extra inputs in a hand-crafted POST must not reach the JSON column.
    const result = readFieldValues(
      contractSchema,
      reader({ [fieldInputName("transferable")]: "yes", field_injected: "evil", note: "evil" }),
    );
    expect(result).toEqual({ ok: true, values: { transferable: "yes" } });
  });

  it("rejects an enum value outside its options", () => {
    const result = readFieldValues(contractSchema, reader({ [fieldInputName("transferable")]: "maybe" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(/not one of the allowed values/);
  });

  it("reports every bad field, not just the first", () => {
    const result = readFieldValues(
      contractSchema,
      reader({ [fieldInputName("transferable")]: "maybe", [fieldInputName("penaltyAmount")]: "lots" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it("leaves untouched fields alone when the form omits them entirely", () => {
    // An absent input means "this form didn't carry that field", not "clear it".
    const result = readFieldValues(contractSchema, reader({}));
    expect(result).toEqual({ ok: true, values: {} });
  });
});

describe("table fields", () => {
  it("reads consecutive rows and drops blank ones", () => {
    const result = readFieldValues(
      tableSchema,
      reader({
        [tableInputName("tools", 0, "tool")]: "Toast POS",
        [tableInputName("tools", 0, "monthlyCost")]: "$165",
        [tableInputName("tools", 0, "transfers")]: "transfers",
        // Row 1 left entirely blank by the consultant — must not become an empty row.
        [tableInputName("tools", 1, "tool")]: "",
        [tableInputName("tools", 1, "monthlyCost")]: "",
        [tableInputName("tools", 1, "transfers")]: "",
        [tableInputName("tools", 2, "tool")]: "Mailchimp",
        [tableInputName("tools", 2, "monthlyCost")]: "20",
        [tableInputName("tools", 2, "transfers")]: "rebuild",
      }),
    );
    expect(result).toEqual({
      ok: true,
      values: {
        tools: [
          { tool: "Toast POS", monthlyCost: "165", transfers: "transfers" },
          { tool: "Mailchimp", monthlyCost: "20", transfers: "rebuild" },
        ],
      },
    });
  });

  it("stops scanning at the first row index the form does not carry", () => {
    const result = readFieldValues(
      tableSchema,
      reader({
        [tableInputName("tools", 0, "tool")]: "Square",
        // no row 1 inputs at all; row 2 exists but is unreachable and must be ignored
        [tableInputName("tools", 2, "tool")]: "Unreachable",
      }),
    );
    expect(result).toEqual({ ok: true, values: { tools: [{ tool: "Square" }] } });
  });

  it("surfaces a per-cell error with its row number", () => {
    const result = readFieldValues(
      tableSchema,
      reader({
        [tableInputName("tools", 0, "tool")]: "Toast",
        [tableInputName("tools", 0, "monthlyCost")]: "a lot",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].label).toMatch(/row 1/);
  });
});

describe("reading persisted values", () => {
  it("round-trips what readFieldValues wrote", () => {
    const written = readFieldValues(
      contractSchema,
      reader({ [fieldInputName("transferable")]: "unclear", [fieldInputName("penaltyAmount")]: "5000" }),
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(readPersistedValues(contractSchema, written.values)).toEqual(written.values);
  });

  it("drops keys the schema no longer declares", () => {
    // A report generated today may render a finding recorded against an older field set.
    expect(readPersistedValues(contractSchema, { transferable: "yes", retiredField: "x" })).toEqual({
      transferable: "yes",
    });
  });

  it("drops values whose shape drifted", () => {
    expect(readPersistedValues(contractSchema, { transferable: { nested: true } })).toEqual({});
    expect(readPersistedValues(tableSchema, { tools: "not-an-array" })).toEqual({});
  });

  it("tolerates a non-object column entirely", () => {
    expect(readPersistedValues(contractSchema, null)).toEqual({});
    expect(readPersistedValues(contractSchema, ["a"])).toEqual({});
  });
});

describe("formatting", () => {
  it("formats money from its canonical stored form", () => {
    expect(formatFieldValue(contractSchema.fields[1], "12000")).toBe("$12,000.00");
  });

  it("formats percent and boolean", () => {
    expect(formatFieldValue({ key: "r", label: "R", kind: "percent" }, "0.9")).toBe("0.9%");
    expect(formatFieldValue({ key: "b", label: "B", kind: "boolean" }, "true")).toBe("Yes");
    expect(formatFieldValue({ key: "b", label: "B", kind: "boolean" }, "false")).toBe("No");
  });
});
