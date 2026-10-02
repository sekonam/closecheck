/**
 * What this firm recorded about the same vendor on a previous engagement.
 *
 * Reference only — there is no control here that writes anything into the finding. The reasoning
 * is in src/lib/audit/vendorMemory.ts and is worth repeating where someone might be tempted to add
 * one: a prefilled value is indistinguishable, in this form and then in the generated report, from
 * a value read out of *this* deal's contract. The failure that design invites is last deal's
 * termination penalty shipping to this buyer as a finding about their target, with the
 * consultant's name on it.
 *
 * What it keeps is the part that actually helps: knowing what to look for before reading the
 * contract, and noticing when this one differs from the last — which is itself a finding.
 */

import type { RecalledField } from "@/lib/audit/vendorMemory";

export function VendorRecall({
  vendorLabel,
  sourceBusinessName,
  recordedAt,
  fields,
}: {
  vendorLabel: string;
  sourceBusinessName: string;
  recordedAt: Date;
  fields: RecalledField[];
}) {
  if (fields.length === 0) return null;
  const divergent = fields.filter((field) => field.differs);

  return (
    // `rounded-md bg-slate-50` is pinned: tests/integration/audit-workflow.itest.ts locates this
    // panel as `div.rounded-md.bg-slate-50` to assert it holds no control that could write a
    // recalled value into the finding. slate-50 and ink-50 are the same colour to the eye, so the
    // selector costs nothing visually — but renaming it would silently unhook that assertion.
    <div className="mt-3 rounded-md border border-ink-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-ink-700">You audited {vendorLabel} before</div>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
        Recorded on {sourceBusinessName}, {recordedAt.toISOString().slice(0, 10)}. Shown for
        reference — read this deal&rsquo;s own document; terms vary between contracts.
      </p>

      <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.label}
            className="flex items-baseline justify-between gap-2 border-b border-ink-200 pb-1 text-xs last:border-0"
          >
            <dt className="text-ink-500">{field.label}</dt>
            <dd className={field.differs ? "font-semibold text-sev-amber" : "text-ink-800"}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>

      {divergent.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-sev-amber">
          {divergent.length === 1 ? "One answer differs" : `${divergent.length} answers differ`} from
          what you recorded last time. Either this contract was negotiated differently — worth
          saying so in the finding — or one of the two readings is wrong.
        </p>
      )}
    </div>
  );
}
