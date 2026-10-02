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

import { cn } from "@/components/ui";
import { BLOCKING_LABEL } from "@/lib/audit/blocking";
import { consultantNoticesFor } from "@/lib/templates/policyWatch";

const CHIP =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

/**
 * The disclosure indicator, drawn with borders instead of a glyph. globals.css hides the native
 * marker, so each <summary> has to supply its own; a CSS triangle adds no text node, which keeps it
 * out of the verbatim-asserted copy on this page.
 */
export const DISCLOSURE_CARET =
  "h-0 w-0 shrink-0 border-y-[3.5px] border-l-[5px] border-y-transparent border-l-ink-400 " +
  "transition-transform duration-150 group-open:rotate-90";

/**
 * The same caret for a <summary> that stays in normal inline flow. Deliberately not a flex summary
 * in the trails: flex blockifies each text node into its own item, which inserts a line break into
 * innerText and splits summary strings the browser suites match whole.
 */
export const DISCLOSURE_CARET_INLINE = `${DISCLOSURE_CARET} mr-1.5 inline-block align-middle`;

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
      className={cn(
        CHIP,
        reason
          ? "border-sev-amber-border bg-sev-amber-bg text-sev-amber"
          : "border-ink-200 bg-ink-50 text-ink-600",
      )}
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
      <span className={cn(CHIP, "border-sev-green-border bg-sev-green-bg text-sev-green")}>
        {expectation === EvidenceExpectation.DOCUMENT ? "Document attached" : "Attestation recorded"}
      </span>
    );
  }

  // A rating with nothing behind it is the case worth colouring: it's a claim a buyer could ask
  // about and the consultant could not answer. An unrated item missing its evidence is just work
  // not done yet, which is unremarkable.
  return (
    <span
      className={cn(
        CHIP,
        rated
          ? "border-sev-red-border bg-sev-red-bg text-sev-red"
          : "border-ink-200 bg-ink-50 text-ink-500",
      )}
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

/** One reference disclosure inside the guidance block. */
function Reference({ label, body }: { label: string; body: string }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900">
        <span aria-hidden="true" className={DISCLOSURE_CARET} />
        {label}
      </summary>
      <p className="border-t border-ink-200 bg-white px-3 py-2 text-xs leading-relaxed whitespace-pre-line text-ink-700">
        {body}
      </p>
    </details>
  );
}

export function FindingGuidance({
  itemTitle,
  guidance,
  severityGuidance,
  unavailable,
}: {
  itemTitle: string;
  guidance: string | null;
  severityGuidance: string | null;
  unavailable: string | null;
}) {
  // Only ever an ADOPTED_UNDATED watch — a published change with no published effective date, where
  // the consultant's judgement at the audit date is the only thing that can resolve it. Facts on a
  // known timetable resolve themselves, and facts we simply need to re-read are held by a review
  // date and the test suite, not handed to the person paying us to carry less of this. See
  // src/lib/templates/policyWatch.ts.
  const policyNotices = consultantNoticesFor(itemTitle);
  if (!guidance && !severityGuidance && !unavailable && policyNotices.length === 0) return null;

  return (
    <div className="mt-2.5 space-y-1.5">
      {unavailable && (
        <p className="rounded-md border border-sev-amber-border bg-sev-amber-bg px-2.5 py-1.5 text-xs leading-relaxed text-sev-amber">
          {unavailable}
        </p>
      )}
      {policyNotices.map((notice) => (
        <p
          key={notice.slice(0, 40)}
          className="rounded-md border border-accent-200 bg-accent-50 px-2.5 py-1.5 text-xs leading-relaxed text-accent-900"
        >
          <span className="font-semibold">Policy in flux · </span>
          {notice}
        </p>
      ))}
      {(guidance || severityGuidance) && (
        <div className="divide-y divide-ink-200 overflow-hidden rounded-md border border-ink-200 bg-ink-50">
          {guidance && <Reference label="How to verify this" body={guidance} />}
          {severityGuidance && (
            <Reference label="When this is Red, Yellow or Green" body={severityGuidance} />
          )}
        </div>
      )}
    </div>
  );
}
