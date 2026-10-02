/**
 * The access trail for one Client Portal Link, shown to the consultant.
 *
 * docs/spec.md §8 promises a record of "who viewed/exported/shared a given Report and when", and
 * docs/roadmap.md Phase 3 lists surfacing it to consultants as a deliverable in its own right —
 * the point being that once a buyer is reading the report directly, the consultant needs to be
 * able to say what happened to it. Until now the audit page showed only a count and the most
 * recent view, which answers "has anyone looked" but not "what happened to this report".
 *
 * There is no "who" for an anonymous buyer, by design: spec.md §7 says the portal collects no
 * buyer data beyond what the access log needs, and the log stores a SHA-256 of the client address
 * rather than the address itself. That still supports the question a consultant actually asks —
 * "did they read it once or come back to it, and was it more than one person?" — because repeat
 * visits from the same origin share a hash. So this groups by hash and labels the groups
 * positionally. It deliberately does not attempt to identify anyone, and says so on screen, so a
 * consultant doesn't over-read it when relaying it to a client.
 */

import { DISCLOSURE_CARET_INLINE } from "./FindingGuidance";
import {
  collapseEmbeddedFetches,
  describeAccessSummary,
  labelOrigins,
  summarizeAccess,
  type AccessEntry,
} from "@/lib/portal/accessHistory";

type Props = {
  /** Which seat sent this report outside. Null for links created before it was recorded. */
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /**
   * Which seat withdrew the link. Null for a link revoked before this was recorded, and for one
   * still live. Deliberately distinct from createdBy: spec.md §12's open question is entirely about
   * the case where they differ, and showing the creator beside "Revoked" would name the wrong
   * person for the one action a firm would be trying to understand.
   */
  revokedBy: string | null;
  accessLog: AccessEntry[];
};

function formatTimestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function PortalAccessHistory({
  createdBy,
  createdAt,
  expiresAt,
  revokedAt,
  revokedBy,
  accessLog: rawLog,
}: Props) {
  // Every request is logged; the page's own embedded viewer is collapsed here rather than being
  // skipped at write time, because at write time the only way to recognise it was a header the
  // client could forge to erase itself.
  const accessLog = collapseEmbeddedFetches(rawLog);
  const originLabels = labelOrigins(accessLog);
  const summary = summarizeAccess(accessLog);
  // Oldest first. This is a trail: "created" then what happened, in the order it happened, ending
  // at revoked or expiry. Rendering the views newest-first inside a list that starts with the
  // link's creation and ends with its revocation reads as neither order.
  const chronologicalViews = [...accessLog].sort((a, b) => a.viewedAt.getTime() - b.viewedAt.getTime());

  return (
    <details className="group mt-1 text-xs">
      <summary className="text-ink-500 hover:text-ink-800">
        <span aria-hidden="true" className={DISCLOSURE_CARET_INLINE} />
        Access history — {describeAccessSummary(summary)}
      </summary>

      <ol className="mt-1.5 space-y-1 border-l-2 border-ink-200 pl-3">
        <li className="text-ink-500">
          <span className="font-medium text-ink-700">
            {createdBy ? `Sent by ${createdBy}` : "Link created"}
          </span>{" "}
          · {formatTimestamp(createdAt)}
        </li>

        {accessLog.length === 0 && (
          <li className="text-ink-400">
            No views recorded. If the buyer says they read it, check they weren&rsquo;t sent the PDF
            by another route.
          </li>
        )}

        {chronologicalViews.map((entry) => (
          <li key={entry.id} className="text-ink-500">
            <span className="font-medium text-ink-700">
              {entry.kind === "DOCUMENT" ? "Report downloaded" : "Viewed"}
            </span>{" "}
            · {formatTimestamp(entry.viewedAt)}
            {entry.ipHash ? (
              <span className="text-ink-400"> · {originLabels.get(entry.ipHash)}</span>
            ) : (
              <span className="text-ink-400"> · origin not recorded</span>
            )}
          </li>
        ))}

        {revokedAt && (
          <li className="text-ink-500">
            <span className="font-medium text-ink-700">
              {revokedBy ? `Revoked by ${revokedBy}` : "Revoked"}
            </span>{" "}
            · {formatTimestamp(revokedAt)}
          </li>
        )}

        <li className="text-ink-400">
          {revokedAt ? "Revoked before expiry" : `Expires ${formatTimestamp(expiresAt)}`}
        </li>
      </ol>

      <p className="mt-1.5 leading-relaxed text-ink-400">
        Origins are grouped from a one-way hash of the viewer&rsquo;s network address — enough to tell
        a repeat visit from a new one, not enough to identify anyone. Several people behind one
        office connection will appear as a single viewer.
        {summary.unattributedViews > 0 &&
          ` ${summary.unattributedViews} view${
            summary.unattributedViews === 1 ? "" : "s"
          } arrived without a recordable origin, and ${
            summary.unattributedViews === 1 ? "is" : "are"
          } not counted as a viewer either way.`}
      </p>
    </details>
  );
}
