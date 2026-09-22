/**
 * Grouping the portal access log into distinct viewers.
 *
 * Pure logic, kept out of the component so it can be tested directly — the labelling rule is the
 * part a consultant will lean on when telling a client "they read it twice", and it should not be
 * possible to change it without a test noticing.
 */

export type AccessEntry = {
  id: string;
  viewedAt: Date;
  ipHash: string | null;
  /** PAGE when the buyer opened the portal, DOCUMENT when the report bytes were fetched. */
  kind?: "PAGE" | "DOCUMENT";
};

/**
 * How close a document fetch has to be to a page view to be that page's own embedded viewer.
 *
 * The viewer fetches the report as a subresource of the page it sits in, so the two arrive within
 * one round trip of each other. This used to be decided by a request header the client controlled,
 * which meant a client could erase itself from the trail entirely by claiming to be that viewer.
 * Deciding it here costs a display artefact when it is wrong — a real separate download moments
 * after a page view reads as one access — rather than costing the evidence.
 */
const EMBEDDED_VIEWER_WINDOW_MS = 5_000;

/**
 * Collapse each page view and its own viewer's document fetch into one access.
 *
 * Only ONE document fetch is absorbed per page view. A viewer fetches the report once; a second
 * fetch in the same window is somebody downloading it, and must survive into the trail.
 */
export function collapseEmbeddedFetches(entries: AccessEntry[]): AccessEntry[] {
  const chronological = [...entries].sort((a, b) => a.viewedAt.getTime() - b.viewedAt.getTime());
  const absorbed = new Set<string>();

  for (const entry of chronological) {
    if (entry.kind !== "PAGE") continue;
    const companion = chronological.find(
      (candidate) =>
        candidate.kind === "DOCUMENT" &&
        !absorbed.has(candidate.id) &&
        candidate.ipHash === entry.ipHash &&
        candidate.viewedAt.getTime() >= entry.viewedAt.getTime() &&
        candidate.viewedAt.getTime() - entry.viewedAt.getTime() <= EMBEDDED_VIEWER_WINDOW_MS,
    );
    if (companion) absorbed.add(companion.id);
  }

  return entries.filter((entry) => !absorbed.has(entry.id));
}

/**
 * Label each distinct origin positionally, in first-seen order.
 *
 * Letters, not the hashes: a hex digest on screen invites a consultant to treat it as an
 * identifier and paste it somewhere, and it isn't one — it's a salt-free hash of an address that
 * may be a shared office NAT covering the whole advisory team.
 */
export function labelOrigins(entries: AccessEntry[]): Map<string, string> {
  const labels = new Map<string, string>();
  const chronological = [...entries].sort((a, b) => a.viewedAt.getTime() - b.viewedAt.getTime());
  for (const entry of chronological) {
    if (!entry.ipHash || labels.has(entry.ipHash)) continue;
    labels.set(entry.ipHash, `Viewer ${indexToLabel(labels.size)}`);
  }
  return labels;
}

/**
 * 0 → A, 25 → Z, 26 → AA. Plain `String.fromCharCode(65 + n)` runs off the end of the alphabet and
 * labels the 27th origin "Viewer [", which is the kind of detail nobody notices until a widely
 * forwarded report produces it in front of a client.
 */
function indexToLabel(index: number): string {
  let label = "";
  let remaining = index;
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

export type AccessSummary = {
  totalViews: number;
  distinctOrigins: number;
  unattributedViews: number;
};

/**
 * The one-line summary shown before the trail is expanded.
 *
 * Counted carefully because this is the line a consultant is most likely to repeat to a client.
 * Views with no recorded origin are NOT folded into the distinct-origin count — two views that
 * both arrived without a forwarded address are not evidence of one viewer, nor of two — so they
 * are reported separately rather than silently changing what "from N origins" means.
 */
export function summarizeAccess(entries: AccessEntry[]): AccessSummary {
  return {
    totalViews: entries.length,
    distinctOrigins: labelOrigins(entries).size,
    unattributedViews: entries.filter((entry) => !entry.ipHash).length,
  };
}

export function describeAccessSummary(summary: AccessSummary): string {
  if (summary.totalViews === 0) return "never viewed";

  const views = `viewed ${summary.totalViews} time${summary.totalViews === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (summary.distinctOrigins > 1) parts.push(`${summary.distinctOrigins} origins`);
  if (summary.unattributedViews > 0) {
    parts.push(
      `${summary.unattributedViews} without a recorded origin`,
    );
  }
  return parts.length > 0 ? `${views} — ${parts.join(", ")}` : views;
}
