/**
 * The consultant-facing half of a checklist item: how to run it, when it's Red, whether it can be
 * started yet, and whether the rating currently has anything behind it.
 *
 * Template v3 records a verification procedure and a severity rubric on every manual item — that
 * content is the product's core IP (`.claude/skills/audit-methodology`), and it is worth nothing
 * sitting in a database column. This is where it reaches the person doing the work.
 *
 * Everything here is INTERNAL. None of it may reach the generated report: `description` is the
 * client-facing string, `guidance` and `severityGuidance` are for the consultant only. That split
 * exists because internal methodology text was previously rendering verbatim into the whitelabeled
 * PDF handed to a buyer.
 *
 * Built on <details>, so it collapses without client JS and without turning this server component
 * into a client one — and so a consultant working offline on a broker's wifi still gets it.
 */

import { BlockingDependency, EvidenceExpectation } from "@prisma/client";

import { BLOCKING_LABEL } from "@/lib/audit/blocking";

const CHIP = "rounded-full px-2 py-0.5 text-xs font-medium";

export function BlockingChip({
  dependency,
  reason,
}: {
  dependency: BlockingDependency;
  reason: string | null;
}) {
  if (dependency === BlockingDependency.NONE) return null;
  return (
    <span
      className={`${CHIP} ${reason ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}
      title={reason ?? "Your deal stage should allow this now."}
    >
      {BLOCKING_LABEL[dependency]}
    </span>
  );
}

export function EvidenceChip({
  expectation,
  satisfied,
  rated,
}: {
  expectation: EvidenceExpectation;
  satisfied: boolean;
  rated: boolean;
}) {
  if (expectation === EvidenceExpectation.NONE) return null;

  const noun = expectation === EvidenceExpectation.DOCUMENT ? "document" : "attestation";
  if (satisfied) {
    return (
      <span className={`${CHIP} bg-emerald-50 text-emerald-700`}>
        {expectation === EvidenceExpectation.DOCUMENT ? "Document attached" : "Attestation recorded"}
      </span>
    );
  }

  // A rating with nothing behind it is the case worth colouring: it's a claim a buyer could ask
  // about and the consultant could not answer. An unrated item missing its evidence is just work
  // not done yet, which is unremarkable.
  return (
    <span
      className={`${CHIP} ${rated ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}
      title={
        rated
          ? `This item is rated but has no ${noun} behind it. The rating will still appear in the report — consider whether you could defend it.`
          : `This item expects a ${noun}.`
      }
    >
      {rated ? `Rated with no ${noun}` : `${noun[0].toUpperCase()}${noun.slice(1)} expected`}
    </span>
  );
}

export function FindingGuidance({
  guidance,
  severityGuidance,
  unavailable,
}: {
  guidance: string | null;
  severityGuidance: string | null;
  unavailable: string | null;
}) {
  if (!guidance && !severityGuidance && !unavailable) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {unavailable && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {unavailable}
        </p>
      )}
      {guidance && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
            How to verify this
          </summary>
          <p className="mt-1 whitespace-pre-line border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-600">
            {guidance}
          </p>
        </details>
      )}
      {severityGuidance && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
            When this is Red, Yellow or Green
          </summary>
          <p className="mt-1 whitespace-pre-line border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-600">
            {severityGuidance}
          </p>
        </details>
      )}
    </div>
  );
}
