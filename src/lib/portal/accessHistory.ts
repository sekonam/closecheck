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
    labels.set(entry.ipHash, `Viewer ${String.fromCharCode(65 + labels.size)}`);
  }
  return labels;
}
