/**
 * Renders a checklist item's structured-capture inputs from the item's own declared field schema
 * (docs/spec.md §4's Tier B requirement: turn "here's a PDF contract" into a structured, comparable
 * finding rather than just storing an attachment).
 *
 * Server component, no client JS. The table field renders the rows already captured plus a couple
 * of blank ones, so "add a row" is just "fill in a blank and save" — after each save you get blank
 * rows back. That keeps the whole audit-taking surface working without hydration, which matters
 * because a consultant may be filling this in on a broker's guest wifi mid-deal.
 */

import {
  TABLE_BLANK_ROWS,
  fieldInputName,
  tableInputName,
  type ColumnDef,
  type FieldDef,
  type FieldValues,
  type ItemFieldSchema,
  type ScalarFieldKind,
} from "@/lib/templates/fieldSchema";

const INPUT_CLASS =
  "mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900";

/** The `type`/`inputMode` pairing that makes each kind pleasant to type on a phone as well. */
function inputAttrs(kind: ScalarFieldKind): { type: string; inputMode?: "decimal" | "text" } {
  switch (kind) {
    case "date":
      return { type: "date" };
    case "money":
    case "percent":
      // Deliberately not type="number": consultants paste "$12,000" straight off a contract and a
      // number input silently discards it. normalizeMoney/normalizePercent canonicalise instead.
      return { type: "text", inputMode: "decimal" };
    default:
      return { type: "text" };
  }
}

function ScalarInput({
  name,
  kind,
  options,
  placeholder,
  value,
}: {
  name: string;
  kind: ScalarFieldKind;
  options?: readonly string[];
  placeholder?: string;
  value: string;
}) {
  if (kind === "enum") {
    return (
      <select name={name} defaultValue={value} className={INPUT_CLASS}>
        <option value="">Not recorded</option>
        {options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (kind === "boolean") {
    return (
      <select name={name} defaultValue={value} className={INPUT_CLASS}>
        <option value="">Not recorded</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (kind === "longtext") {
    return <textarea name={name} defaultValue={value} placeholder={placeholder} rows={3} className={INPUT_CLASS} />;
  }

  const attrs = inputAttrs(kind);
  return (
    <input
      name={name}
      type={attrs.type}
      inputMode={attrs.inputMode}
      defaultValue={value}
      placeholder={placeholder}
      className={INPUT_CLASS}
    />
  );
}

function TableField({ field, rows }: { field: FieldDef; rows: Record<string, string>[] }) {
  const columns = (field.columns ?? []) as ColumnDef[];
  // Existing rows stay editable in place; the blanks on the end are how a row gets added without
  // client-side JS. Row indices must stay contiguous from 0 — readFieldValues stops scanning at
  // the first index the form doesn't carry.
  const renderedRows = rows.length + TABLE_BLANK_ROWS;

  return (
    <div className="col-span-full">
      <div className="text-xs font-medium text-slate-600">{field.label}</div>
      {field.help && <div className="mt-0.5 text-xs text-slate-400">{field.help}</div>}
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="pb-1 pr-2 text-xs font-medium text-slate-500">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: renderedRows }, (_, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.key} className="pb-1 pr-2 align-top">
                    <ScalarInput
                      name={tableInputName(field.key, rowIndex, column.key)}
                      kind={column.kind}
                      options={column.options}
                      placeholder={column.placeholder}
                      value={rows[rowIndex]?.[column.key] ?? ""}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-0.5 text-xs text-slate-400">
        Blank rows are ignored. Save to add more.
      </div>
    </div>
  );
}

export function StructuredFields({ schema, values }: { schema: ItemFieldSchema; values: FieldValues }) {
  return (
    <div className="col-span-full grid grid-cols-1 gap-3 border-t border-slate-100 pt-2 sm:grid-cols-3">
      {schema.fields.map((field) => {
        if (field.kind === "table") {
          const rows = Array.isArray(values[field.key]) ? (values[field.key] as Record<string, string>[]) : [];
          return <TableField key={field.key} field={field} rows={rows} />;
        }
        const value = typeof values[field.key] === "string" ? (values[field.key] as string) : "";
        return (
          <label key={field.key} className="text-xs text-slate-500">
            {field.label}
            <ScalarInput
              name={fieldInputName(field.key)}
              kind={field.kind}
              options={field.options}
              placeholder={field.placeholder}
              value={value}
            />
            {field.help && <span className="mt-0.5 block text-xs text-slate-400">{field.help}</span>}
          </label>
        );
      })}
    </div>
  );
}
