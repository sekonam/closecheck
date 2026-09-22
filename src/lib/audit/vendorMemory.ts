/**
 * What this firm found the last time it looked at a vendor.
 *
 * WHY
 * ---
 * docs/spec.md §2.2 puts the value proposition against "ad hoc, no repeatable process" as
 * *consistency across engagements*. A consultant running their tenth restaurant deal has read the
 * Toast agreement before, and the product has been making them start from nothing every time.
 *
 * This is also the one asset here that compounds: every audit makes the next one better-informed,
 * and a competitor shipping automated-checks-to-PDF cannot copy it by adding a feature, because it
 * only exists if a firm has done the work. docs/roadmap.md's competitive-window note calls exactly
 * this the durable moat.
 *
 * WHY IT DOES NOT PREFILL — the important part
 * -------------------------------------------
 * The obvious design is to prefill the finding from the last deal. That design is dangerous, and
 * deliberately not what this does.
 *
 * A prefilled field is indistinguishable, in the audit UI and then in the generated report, from
 * one the consultant read out of *this* deal's contract. So the failure mode is: last deal's
 * early-termination penalty ships to this buyer as a finding about their target, with the
 * consultant's name on it and a severity attached. That is materially worse than retyping — it is
 * the product manufacturing a false statement of fact about a business, which is the one thing a
 * diligence deliverable cannot do.
 *
 * So the memory is REFERENCE ONLY. It shows what was recorded before, names the engagement it came
 * from and when, and leaves the consultant to read this deal's document. That keeps the real value
 * — knowing what to look for, and noticing when this contract differs from the last one, which is
 * itself a finding — while making it impossible for one deal's facts to become another's.
 *
 * WHAT IDENTIFIES A VENDOR
 * ------------------------
 * A convention over field keys rather than a declaration in the template, deliberately: adding an
 * `identityField` to the schema shape would mean republishing every template to express something
 * the existing field names already say. Items whose schema uses none of these keys simply have no
 * memory, which is the right degradation — nothing breaks, the feature is just absent there.
 */

import type { FieldValues, ItemFieldSchema } from "@/lib/templates/fieldSchema";

/**
 * Field keys that name the vendor an item is about, in priority order. Drawn from the field
 * schemas template v3/v4 actually declare.
 */
const VENDOR_IDENTITY_KEYS = ["vendor", "platform", "processor", "gateway"] as const;

/** The vendor a finding is about, as the consultant typed it, or null if the item names none. */
export function vendorLabelFor(schema: ItemFieldSchema, values: FieldValues): string | null {
  const declared = new Set(schema.fields.map((field) => field.key));
  for (const key of VENDOR_IDENTITY_KEYS) {
    if (!declared.has(key)) continue;
    const value = values[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Matching key for a vendor name.
 *
 * "Toast", "toast", "Toast POS" and "Toast, Inc." are one vendor to a consultant and should be one
 * row. Lowercased, stripped of punctuation and of the corporate suffixes and product-category
 * words that vary by how someone happened to type it that day. Deliberately conservative: it is
 * better to keep two profiles for the same vendor than to merge two different ones and show a
 * consultant terms from the wrong contract.
 */
export function vendorKeyFor(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[.,''"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stripped = base
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|sa|bv)\b/g, " ")
    .replace(/\b(pos|software|systems|system|platform|payments|payment)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // A vendor whose entire name is made of those words — "Payments Inc", "Systems Ltd" — strips to
  // nothing, and every such vendor would then share one key and one profile. That is the leak this
  // whole module is careful about, arriving through the back door: a consultant would be shown
  // another company's contract terms under their vendor's name. Keep the unstripped form instead.
  return stripped === "" ? base : stripped;
}

export type VendorMemory = {
  vendorLabel: string;
  sourceBusinessName: string;
  recordedAt: Date;
  values: FieldValues;
};

export type RecalledField = {
  label: string;
  /** Formatted for display, through the same formatter the live fields use. */
  value: string;
  /** True when this deal's recorded answer differs from what the firm recorded last time. */
  differs: boolean;
};

/**
 * What to show a consultant from a previous engagement, field by field.
 *
 * Divergence is surfaced rather than hidden. Two deals on the same platform with different
 * transferability answers is either a negotiated variation worth noting in the report, or a
 * mistake in one of the two readings — both are things the consultant should see, and neither is
 * visible if the memory only shows what matches.
 */
export function recallFields(
  schema: ItemFieldSchema,
  memory: VendorMemory,
  current: FieldValues,
  format: (fieldKey: string, value: string) => string,
): RecalledField[] {
  const recalled: RecalledField[] = [];

  for (const field of schema.fields) {
    // Tables are per-deal inventories, not vendor characteristics — recalling one would suggest
    // the last client's tool list belongs to this one.
    if (field.kind === "table") continue;
    // The vendor's own name is the key, not a recalled fact about it.
    if ((VENDOR_IDENTITY_KEYS as readonly string[]).includes(field.key)) continue;

    const remembered = memory.values[field.key];
    if (typeof remembered !== "string" || remembered === "") continue;

    const currentValue = current[field.key];
    recalled.push({
      label: field.label,
      value: format(field.key, remembered),
      differs: typeof currentValue === "string" && currentValue !== "" && currentValue !== remembered,
    });
  }

  return recalled;
}

/**
 * Should this finding's values be remembered?
 *
 * Only when there is a vendor to attach them to and something worth attaching — a profile holding
 * nothing but a vendor name is noise that makes the panel look broken rather than empty.
 */
export function isWorthRemembering(schema: ItemFieldSchema, values: FieldValues): boolean {
  if (!vendorLabelFor(schema, values)) return false;
  return recallFields(schema, { vendorLabel: "", sourceBusinessName: "", recordedAt: new Date(), values }, {}, (_, v) => v).length > 0;
}
