/**
 * Declared structured-field schemas for checklist items.
 *
 * WHY THIS EXISTS
 * ---------------
 * spec.md §4 on Tier B: "The product's job is to turn 'here's a PDF contract' into a structured,
 * comparable finding (transferable: yes/no/unclear, penalty: $X or Y% of ARR) rather than just
 * storing an attachment."
 *
 * That parenthetical is an *example* of one item's fields. The previous implementation treated it
 * as the exhaustive schema: three hardcoded keys, switched on by a `/contract/i` regex against the
 * item's title. Five of the eight Tier B items across the shipped templates matched no regex and
 * so captured nothing structured at all — they degraded to "upload a PDF, write a sentence", which
 * is precisely the behaviour the spec names as insufficient.
 *
 * WHY THE SCHEMA LIVES ON TemplateItem AND NOT IN CODE
 * ----------------------------------------------------
 * spec.md §5 pins an in-progress Audit to the Template version it started on, so that a checklist
 * change can never silently reinterpret findings a consultant already recorded. A field set
 * defined in application code would sit *outside* that guarantee: editing it would change the
 * meaning of every historical `Finding.structuredData` at once, retroactively, with no version to
 * pin to and no migration story. Storing the schema on the TemplateItem row puts it inside the
 * existing versioning machinery for free — an audit reads the field definitions from the same
 * pinned template row it reads the item's title from.
 *
 * This module is the *shape* of that schema and the rules for reading values into and out of it.
 * The actual per-item field sets are content, and live in `content.ts` next to the item they
 * belong to (owned by the `audit-methodology` skill).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

/**
 * Deliberately small. Every kind here is one spec.md §4 actually asks for somewhere in the Tier B
 * table; none is speculative. Resist adding kinds without an item that needs one — an unused field
 * kind is a rendering branch, a validation branch, and a report-rendering branch that can rot.
 */
export const SCALAR_FIELD_KINDS = [
  "text", // short free text — a vendor name, a clause reference
  "longtext", // multi-line free text — an observation, a quoted clause
  "enum", // one of a fixed set — the transferable: yes/no/unclear shape
  "money", // a currency amount, stored canonically so two audits are comparable
  "percent", // 0–100, e.g. a chargeback rate or a rolling reserve
  "date", // ISO date — a term end, an attestation expiry
  "boolean", // yes/no
] as const;

export type ScalarFieldKind = (typeof SCALAR_FIELD_KINDS)[number];
export type FieldKind = ScalarFieldKind | "table";

// ---------------------------------------------------------------------------
// Schema shape
// ---------------------------------------------------------------------------

const fieldKeySchema = z
  .string()
  .min(1)
  .max(60)
  // Keys become form-input names and JSON object keys, and are matched against persisted data.
  // Restricting them to this alphabet keeps `field_<key>_<row>_<col>` form names unambiguous.
  .regex(/^[a-z][a-zA-Z0-9]*$/, "field keys must be lowerCamelCase");

const columnSchema = z.object({
  key: fieldKeySchema,
  label: z.string().min(1).max(120),
  kind: z.enum(SCALAR_FIELD_KINDS),
  options: z.array(z.string().min(1).max(60)).min(2).max(12).optional(),
  placeholder: z.string().max(120).optional(),
});

const fieldSchemaEntry = z.object({
  key: fieldKeySchema,
  label: z.string().min(1).max(120),
  kind: z.enum([...SCALAR_FIELD_KINDS, "table"]),
  /** Consultant-facing hint shown under the input. Internal — never rendered into a client PDF. */
  help: z.string().max(400).optional(),
  placeholder: z.string().max(120).optional(),
  /** `enum` only. */
  options: z.array(z.string().min(1).max(60)).min(2).max(12).optional(),
  /** `table` only. */
  columns: z.array(columnSchema).min(1).max(8).optional(),
});

export const itemFieldSchema = z
  .object({ fields: z.array(fieldSchemaEntry).min(1).max(16) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const field of value.fields) {
      if (seen.has(field.key)) {
        ctx.addIssue({ code: "custom", message: `duplicate field key "${field.key}"` });
      }
      seen.add(field.key);

      if (field.kind === "enum" && (!field.options || field.options.length === 0)) {
        ctx.addIssue({ code: "custom", message: `enum field "${field.key}" needs options` });
      }
      if (field.kind !== "enum" && field.options) {
        ctx.addIssue({ code: "custom", message: `options are only valid on enum fields ("${field.key}")` });
      }
      if (field.kind === "table" && (!field.columns || field.columns.length === 0)) {
        ctx.addIssue({ code: "custom", message: `table field "${field.key}" needs columns` });
      }
      if (field.kind !== "table" && field.columns) {
        ctx.addIssue({ code: "custom", message: `columns are only valid on table fields ("${field.key}")` });
      }
      for (const column of field.columns ?? []) {
        if (column.kind === "enum" && (!column.options || column.options.length === 0)) {
          ctx.addIssue({ code: "custom", message: `enum column "${column.key}" needs options` });
        }
      }
    }
  });

export type ItemFieldSchema = z.infer<typeof itemFieldSchema>;
export type FieldDef = ItemFieldSchema["fields"][number];
export type ColumnDef = z.infer<typeof columnSchema>;

/**
 * Read a schema off a persisted `TemplateItem.fieldSchema` JSON column.
 *
 * Fails *closed* and silently: a malformed schema yields null, which means the item renders with
 * no structured fields rather than crashing the whole audit page. A persisted schema can only have
 * got there through `content.ts` and a publish script, both of which validate on the way in
 * (`assertValidFieldSchema`), so a parse failure here means data corruption or a hand-edited row —
 * degrading to "note-only" is the safe response, not a 500 on a consultant mid-engagement.
 */
export function parseFieldSchema(raw: unknown): ItemFieldSchema | null {
  if (raw == null) return null;
  const parsed = itemFieldSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Validate at authoring/publish time, where a bad schema SHOULD be loud. */
export function assertValidFieldSchema(raw: unknown, context: string): ItemFieldSchema {
  const parsed = itemFieldSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid field schema for ${context}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type ScalarValue = string;
export type TableValue = Record<string, string>[];
export type FieldValue = ScalarValue | TableValue;
export type FieldValues = Record<string, FieldValue>;

/** How many blank rows a table field offers beyond the rows already filled in. */
export const TABLE_BLANK_ROWS = 2;

/**
 * Canonicalise a money input so two audits are actually comparable.
 *
 * Consultants type "$12,000", "12000", "12,000.50". All three mean the same number and should
 * compare and aggregate as the same number. The *basis* of a charge ("3 months' fees") is never a
 * money value — items that need it declare a separate text field for it, which is why this can be
 * strict about rejecting non-numeric input instead of falling back to storing free text.
 */
export function normalizeMoney(input: string): string | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return "";
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

function normalizePercent(input: string): string | null {
  const cleaned = input.replace(/[%\s]/g, "");
  if (cleaned === "") return "";
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return cleaned;
}

function normalizeDate(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  // Reject calendar-invalid dates like 2026-02-30 that match the shape but aren't real days.
  const [year, month, day] = trimmed.split("-").map(Number);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

const MAX_TEXT = 300;
const MAX_LONGTEXT = 4000;

function normalizeScalar(
  kind: ScalarFieldKind,
  options: readonly string[] | undefined,
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  switch (kind) {
    case "text": {
      const trimmed = raw.trim();
      if (trimmed.length > MAX_TEXT) return { ok: false, message: `must be ${MAX_TEXT} characters or fewer` };
      return { ok: true, value: trimmed };
    }
    case "longtext": {
      const trimmed = raw.trim();
      if (trimmed.length > MAX_LONGTEXT) return { ok: false, message: `must be ${MAX_LONGTEXT} characters or fewer` };
      return { ok: true, value: trimmed };
    }
    case "enum": {
      const trimmed = raw.trim();
      if (trimmed === "") return { ok: true, value: "" };
      if (!options?.includes(trimmed)) return { ok: false, message: "is not one of the allowed values" };
      return { ok: true, value: trimmed };
    }
    case "money": {
      const normalized = normalizeMoney(raw);
      if (normalized === null) return { ok: false, message: "must be an amount, e.g. 12000 or $12,000.50" };
      return { ok: true, value: normalized };
    }
    case "percent": {
      const normalized = normalizePercent(raw);
      if (normalized === null) return { ok: false, message: "must be a percentage between 0 and 100" };
      return { ok: true, value: normalized };
    }
    case "date": {
      const normalized = normalizeDate(raw);
      if (normalized === null) return { ok: false, message: "must be a real date in YYYY-MM-DD form" };
      return { ok: true, value: normalized };
    }
    case "boolean": {
      const trimmed = raw.trim();
      if (trimmed === "") return { ok: true, value: "" };
      if (trimmed !== "true" && trimmed !== "false") return { ok: false, message: "must be yes or no" };
      return { ok: true, value: trimmed };
    }
  }
}

/** Form-input name for a scalar field. */
export function fieldInputName(fieldKey: string): string {
  return `field_${fieldKey}`;
}

/** Form-input name for one cell of a table field's row. */
export function tableInputName(fieldKey: string, rowIndex: number, columnKey: string): string {
  return `field_${fieldKey}_${rowIndex}_${columnKey}`;
}

export type FieldValueError = { fieldKey: string; label: string; message: string };

/**
 * Read a submitted form into `Finding.structuredData`, driven entirely by the item's own schema.
 *
 * Only keys the schema declares are read, so a caller cannot smuggle extra keys into the JSON
 * column by adding inputs to the posted form — the schema is the allowlist. Values that normalise
 * to empty are omitted rather than stored as "", so "never filled in" and "deliberately blanked"
 * both read as absent and the JSON stays small.
 */
export function readFieldValues(
  schema: ItemFieldSchema,
  read: (name: string) => string | null,
): { ok: true; values: FieldValues } | { ok: false; errors: FieldValueError[] } {
  const values: FieldValues = {};
  const errors: FieldValueError[] = [];

  for (const field of schema.fields) {
    if (field.kind === "table") {
      const rows: Record<string, string>[] = [];
      // Bounded scan: the UI renders existing rows plus TABLE_BLANK_ROWS blanks, so a submission
      // can never legitimately contain more rows than that. The cap stops a hand-crafted POST from
      // making us walk an unbounded index space.
      const maxRows = 200;
      for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
        const row: Record<string, string> = {};
        let sawAnyInput = false;
        let rowHasValue = false;

        for (const column of field.columns ?? []) {
          const raw = read(tableInputName(field.key, rowIndex, column.key));
          if (raw === null) continue;
          sawAnyInput = true;
          const normalized = normalizeScalar(column.kind, column.options, raw);
          if (!normalized.ok) {
            errors.push({
              fieldKey: field.key,
              label: `${field.label} — ${column.label} (row ${rowIndex + 1})`,
              message: normalized.message,
            });
            continue;
          }
          if (normalized.value !== "") {
            row[column.key] = normalized.value;
            rowHasValue = true;
          }
        }

        if (!sawAnyInput) break; // past the end of the submitted rows
        if (rowHasValue) rows.push(row); // drop entirely-blank rows rather than storing empties
      }
      if (rows.length > 0) values[field.key] = rows;
      continue;
    }

    const raw = read(fieldInputName(field.key));
    if (raw === null) continue;
    const normalized = normalizeScalar(field.kind, field.options, raw);
    if (!normalized.ok) {
      errors.push({ fieldKey: field.key, label: field.label, message: normalized.message });
      continue;
    }
    if (normalized.value !== "") values[field.key] = normalized.value;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values };
}

/**
 * Read persisted `Finding.structuredData` back out for rendering, discarding anything that no
 * longer matches the schema.
 *
 * Structured data survives across template versions (an audit stays pinned, but a Report generated
 * from an old audit is still rendered by today's code), so this must tolerate keys the schema no
 * longer declares and values whose shape has drifted. It drops them rather than rendering garbage
 * into a client deliverable.
 */
export function readPersistedValues(schema: ItemFieldSchema, raw: unknown): FieldValues {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const values: FieldValues = {};

  for (const field of schema.fields) {
    const value = source[field.key];
    if (value == null) continue;

    if (field.kind === "table") {
      if (!Array.isArray(value)) continue;
      const rows: Record<string, string>[] = [];
      for (const entry of value) {
        if (entry == null || typeof entry !== "object" || Array.isArray(entry)) continue;
        const row: Record<string, string> = {};
        for (const column of field.columns ?? []) {
          const cell = (entry as Record<string, unknown>)[column.key];
          if (typeof cell === "string" && cell !== "") row[column.key] = cell;
        }
        if (Object.keys(row).length > 0) rows.push(row);
      }
      if (rows.length > 0) values[field.key] = rows;
      continue;
    }

    if (typeof value === "string" && value !== "") values[field.key] = value;
  }

  return values;
}

/** True when the consultant has actually captured something structured for this finding. */
export function hasAnyFieldValue(values: FieldValues): boolean {
  return Object.keys(values).length > 0;
}

/**
 * Human-readable rendering of one stored value, for the audit UI and the report.
 *
 * Kept here, next to normalisation, so the display of a value can never drift from the rules that
 * produced it — a money value is stored canonically and formatted here, in one place.
 */
export function formatFieldValue(field: FieldDef, value: FieldValue): string {
  if (field.kind === "table") return Array.isArray(value) ? `${value.length} rows` : "";
  if (typeof value !== "string") return "";
  switch (field.kind) {
    case "money": {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return value;
      return numeric.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
    }
    case "percent":
      return `${value}%`;
    case "boolean":
      return value === "true" ? "Yes" : "No";
    default:
      return value;
  }
}
