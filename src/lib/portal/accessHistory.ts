/**
 * Grouping the portal access log into distinct viewers.
 *
 * Pure logic, kept out of the component so it can be tested directly — the labelling rule is the
 * part a consultant will lean on when telling a client "they read it twice", and it should not be
 * possible to change it without a test noticing.
 */

export type AccessEntry = { id: string; viewedAt: Date; ipHash: string | null };

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
