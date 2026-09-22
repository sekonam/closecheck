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

import {
  describeAccessSummary,
  labelOrigins,
  summarizeAccess,
  type AccessEntry,
} from "@/lib/portal/accessHistory";

type Props = {
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  accessLog: AccessEntry[];
};

function formatTimestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function PortalAccessHistory({ createdAt, expiresAt, revokedAt, accessLog }: Props) {
  const originLabels = labelOrigins(accessLog);
  const summary = summarizeAccess(accessLog);
  // Oldest first. This is a trail: "created" then what happened, in the order it happened, ending
  // at revoked or expiry. Rendering the views newest-first inside a list that starts with the
  // link's creation and ends with its revocation reads as neither order.
  const chronologicalViews = [...accessLog].sort((a, b) => a.viewedAt.getTime() - b.viewedAt.getTime());

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-800">
        Access history — {describeAccessSummary(summary)}
      </summary>

      <ol className="mt-1.5 space-y-1 border-l-2 border-slate-200 pl-3">
        <li className="text-slate-500">
          <span className="font-medium text-slate-600">Link created</span> · {formatTimestamp(createdAt)}
        </li>

        {accessLog.length === 0 && (
          <li className="text-slate-400">
            No views recorded. If the buyer says they read it, check they weren&rsquo;t sent the PDF
            by another route.
          </li>
        )}

        {chronologicalViews.map((entry) => (
          <li key={entry.id} className="text-slate-500">
            <span className="font-medium text-slate-600">Viewed</span> · {formatTimestamp(entry.viewedAt)}
            {entry.ipHash ? (
              <span className="text-slate-400"> · {originLabels.get(entry.ipHash)}</span>
            ) : (
              <span className="text-slate-400"> · origin not recorded</span>
            )}
          </li>
        ))}

        {revokedAt && (
          <li className="text-slate-500">
            <span className="font-medium text-slate-600">Revoked</span> · {formatTimestamp(revokedAt)}
          </li>
        )}

        <li className="text-slate-400">
          {revokedAt ? "Revoked before expiry" : `Expires ${formatTimestamp(expiresAt)}`}
        </li>
      </ol>

      <p className="mt-1.5 text-slate-400">
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
