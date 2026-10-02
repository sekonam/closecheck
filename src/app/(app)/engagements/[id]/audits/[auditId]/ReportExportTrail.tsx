/**
 * Who in the firm took this report out of the product, and when.
 *
 * docs/spec.md §8 promises a record of "who viewed/exported/shared a given Report and when",
 * surfaced to the consultant — the thing they point at when a buyer's advisory team asks who has
 * had access. Portal views were surfaced; exports were not. They were written to `metric_events`,
 * on which the app role holds INSERT and no SELECT by design, so the product could answer the
 * question for the operator and not for the consultant it was promised to.
 *
 * WHY THIS SITS ON THE REPORT AND NOT INSIDE A LINK'S TRAIL
 * --------------------------------------------------------
 * A report can be exported before it has ever been shared, and exported again after every link has
 * been revoked. Neither case has anywhere to render inside a per-link timeline, and those are
 * precisely the cases a consultant is asked about. So exports belong to the report; the per-link
 * trails nest beneath it.
 *
 * WHY IT IS VISUALLY SEPARATE FROM THE VIEW TRAIL, DELIBERATELY
 * ------------------------------------------------------------
 * These two lists mean opposite things about identity. An export names a colleague, because the
 * firm must be able to say which of its own people took a client's report outside. A portal view
 * names nobody — spec.md §7 collects no buyer data beyond a one-way hash, and PortalAccessHistory
 * says so on screen. Rendered as one list, the hashed-origin caveat reads as though it applies to
 * the export rows too, or worse the reverse, leaving a consultant believing a buyer was identified.
 * Keeping them apart is what keeps each caveat attached to the rows it is true of.
 */

import { DISCLOSURE_CARET_INLINE } from "./FindingGuidance";

const TRAIL_BEGAN = new Date("2026-09-24T09:00:00Z");

export type ReportExport = {
  id: string;
  exportedAt: Date;
  /** Already resolved to a display name — null when the person has since been removed. */
  actor: string | null;
};

function formatTimestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function ReportExportTrail({ exports }: { exports: ReportExport[] }) {
  const chronological = [...exports].sort((a, b) => a.exportedAt.getTime() - b.exportedAt.getTime());

  return (
    <details className="group mt-1.5 text-xs">
      <summary className="text-ink-500 hover:text-ink-800">
        <span aria-hidden="true" className={DISCLOSURE_CARET_INLINE} />
        {chronological.length === 0
          ? "Exports — none recorded"
          : `Exports — ${chronological.length} by this firm`}
      </summary>

      <ol className="mt-1.5 space-y-1 border-l-2 border-ink-300 pl-3">
        {chronological.map((e) => (
          <li key={e.id} className="text-ink-500">
            <span className="font-medium text-ink-700">
              {/* A removed teammate leaves the export standing but unattributed. Saying "someone at
                  this firm" rather than omitting the row keeps the count honest: the export
                  happened, and who did it is what was lost. */}
              {e.actor ? `Downloaded by ${e.actor}` : "Downloaded by someone at this firm"}
            </span>{" "}
            · {formatTimestamp(e.exportedAt)}
          </li>
        ))}

        {chronological.length === 0 && (
          <li className="text-ink-400">
            No one has downloaded this report through the product since exports began being recorded
            on {formatTimestamp(TRAIL_BEGAN)}.
          </li>
        )}
      </ol>

      <p className="mt-1.5 leading-relaxed text-ink-400">
        {/* The two honesty constraints this list must carry, because a consultant may repeat what it
            says to a client's advisory team. */}
        This records downloads through CloseCheck by people in your firm, and nothing else — a report
        forwarded by email, or re-shared from someone&rsquo;s desktop, leaves no trace here. Exports
        made before {formatTimestamp(TRAIL_BEGAN)} were not recorded and do not appear.
      </p>
    </details>
  );
}
