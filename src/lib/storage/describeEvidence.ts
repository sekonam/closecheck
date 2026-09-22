/**
 * The provenance line under an attached document: what it is, how big, who attached it, when.
 *
 * An attachment shown as a bare filename tells a consultant reviewing their own engagement six
 * weeks later almost nothing, and tells a colleague on a Team plan less than that. It also tells a
 * buyer's advisor nothing they can check, which is the bar docs/spec.md §2.1 sets for everything
 * that ends up in the client's hands.
 *
 * Every field is nullable: rows written before provenance was recorded have no answer, and this
 * degrades to whatever it does know rather than printing "unknown" four times.
 */

import { describeMimeType } from "./uploadPolicy";

export type DescribableEvidence = {
  text: string | null;
  label: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
  uploadedBy?: { name: string | null; email: string } | null;
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Who attached it, in the form a report can name — a person, not "the consultant". */
export function attributionFor(
  uploadedBy: { name: string | null; email: string } | null | undefined,
): string | null {
  if (!uploadedBy) return null;
  return uploadedBy.name?.trim() || uploadedBy.email;
}

export function describeEvidence(evidence: DescribableEvidence): string {
  const parts: string[] = [];

  // Show the real filename when a label is standing in front of it — the consultant needs to know
  // which file they are looking at, and a seller's scanner-generated name is often the only way to
  // match it against what was actually sent.
  if (evidence.label && evidence.text) parts.push(evidence.text);

  if (evidence.mimeType) parts.push(describeMimeType(evidence.mimeType));
  if (evidence.sizeBytes != null) parts.push(formatFileSize(evidence.sizeBytes));

  const attribution = attributionFor(evidence.uploadedBy);
  parts.push(
    attribution
      ? `added by ${attribution} on ${evidence.createdAt.toISOString().slice(0, 10)}`
      : `added ${evidence.createdAt.toISOString().slice(0, 10)}`,
  );

  return parts.join(" · ");
}
