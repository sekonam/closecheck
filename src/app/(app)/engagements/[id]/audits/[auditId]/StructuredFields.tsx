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

import { inputClass, selectClass } from "@/components/ui";
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

/**
 * Labels wrap their control instead of pointing at it by id. Field keys repeat across checklist
 * items — two Tier B items can both declare `vendor` — so an id derived from the input name would
 * be duplicated within the page and every such label would address the first match.
 */
const LABEL_TEXT = "mb-1 block text-xs font-medium text-ink-700";
const HELP_TEXT = "mt-1 block text-xs leading-relaxed text-ink-500";

/**
 * Dense variants of inputClass/selectClass for table cells, written out rather than passed in as
 * overrides: Tailwind emits same-property utilities in scale order, so handing `py-1` to a helper
 * that already carries `py-2` leaves both in the class list and the larger one still wins.
 */
const CELL_BASE =
  "block w-full rounded-sm border border-ink-200 bg-white px-2 py-1 text-xs text-ink-900 " +
  "placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-500 focus:outline-none";
const CELL_SELECT = `${CELL_BASE} appearance-none pr-6 bg-[length:14px] bg-[right_0.3rem_center] bg-no-repeat bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%236b7589%22 stroke-width=%222%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M6 9l6 6 6-6%22/%3E%3C/svg%3E')]`;

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
  dense,
}: {
  name: string;
  kind: ScalarFieldKind;
  options?: readonly string[];
  placeholder?: string;
  value: string;
  dense?: boolean;
}) {
  const textClass = dense ? CELL_BASE : inputClass();
  const pickerClass = dense ? CELL_SELECT : selectClass();

  if (kind === "enum") {
    return (
      <select name={name} defaultValue={value} className={pickerClass}>
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
      <select name={name} defaultValue={value} className={pickerClass}>
        <option value="">Not recorded</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (kind === "longtext") {
    return (
      <textarea
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        rows={3}
        className={textClass}
      />
    );
  }

  const attrs = inputAttrs(kind);
  return (
    <input
      name={name}
      type={attrs.type}
      inputMode={attrs.inputMode}
      defaultValue={value}
      placeholder={placeholder}
      className={textClass}
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
    <div className="sm:col-span-3">
      <div className="text-xs font-medium text-ink-700">{field.label}</div>
      {field.help && <div className="mt-0.5 text-xs leading-relaxed text-ink-500">{field.help}</div>}
      <div className="mt-1.5 overflow-x-auto rounded-md border border-ink-200">
        <table className="w-full min-w-[480px] border-collapse text-left">
          <thead>
            <tr className="bg-ink-100">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="border-b border-ink-200 px-2 py-1.5 text-[11px] font-semibold tracking-wide text-ink-600 uppercase"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {Array.from({ length: renderedRows }, (_, rowIndex) => (
              // The blank rows are tinted so the "fill one in and save" affordance reads as an
              // affordance rather than as rows that failed to load.
              <tr key={rowIndex} className={rowIndex >= rows.length ? "bg-ink-50" : "bg-white"}>
                {columns.map((column) => (
                  <td key={column.key} className="px-1.5 py-1 align-top">
                    <ScalarInput
                      name={tableInputName(field.key, rowIndex, column.key)}
                      kind={column.kind}
                      options={column.options}
                      placeholder={column.placeholder}
                      value={rows[rowIndex]?.[column.key] ?? ""}
                      dense
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-xs text-ink-500">Blank rows are ignored. Save to add more.</div>
    </div>
  );
}

export function StructuredFields({
  schema,
  values,
}: {
  schema: ItemFieldSchema;
  values: FieldValues;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-ink-200 pt-3 sm:grid-cols-3">
      {schema.fields.map((field) => {
        if (field.kind === "table") {
          const rows = Array.isArray(values[field.key]) ? (values[field.key] as Record<string, string>[]) : [];
          return <TableField key={field.key} field={field} rows={rows} />;
        }
        const value = typeof values[field.key] === "string" ? (values[field.key] as string) : "";
        return (
          <label key={field.key} className={field.kind === "longtext" ? "block min-w-0 sm:col-span-3" : "block min-w-0"}>
            <span className={LABEL_TEXT}>{field.label}</span>
            <ScalarInput
              name={fieldInputName(field.key)}
              kind={field.kind}
              options={field.options}
              placeholder={field.placeholder}
              value={value}
            />
            {field.help && <span className={HELP_TEXT}>{field.help}</span>}
          </label>
        );
      })}
    </div>
  );
}
