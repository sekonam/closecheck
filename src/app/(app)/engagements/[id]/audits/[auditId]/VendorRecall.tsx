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
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <div className="text-xs font-medium text-slate-600">
        You audited {vendorLabel} before
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Recorded on {sourceBusinessName}, {recordedAt.toISOString().slice(0, 10)}. Shown for
        reference — read this deal&rsquo;s own document; terms vary between contracts.
      </p>

      <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.label} className="flex justify-between gap-2 text-xs">
            <dt className="text-slate-500">{field.label}</dt>
            <dd className={field.differs ? "font-medium text-amber-700" : "text-slate-600"}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>

      {divergent.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-800">
          {divergent.length === 1 ? "One answer differs" : `${divergent.length} answers differ`} from
          what you recorded last time. Either this contract was negotiated differently — worth
          saying so in the finding — or one of the two readings is wrong.
        </p>
      )}
    </div>
  );
}
