/**
 * Citations: which document, and where in it, substantiates a structured claim.
 *
 * WHY
 * ---
 * "Transferable: no" is an assertion. "Transferable: no — §14.2, p.7 of toast-msa-2023.pdf: 'This
 * Agreement may not be assigned…'" is a finding a buyer's counsel can check without asking anyone.
 * docs/spec.md §2.1 says the report is the product; this is most of the distance between a
 * checklist export and a diligence work product, and it is the part a competitor shipping
 * automated-checks-to-PDF cannot copy by adding a feature — it only exists if a consultant did the
 * reading.
 *
 * SHAPE
 * -----
 * Citations live on the Evidence row rather than on the Finding, because the relationship is
 * one document to many claims: a single executed contract typically answers transferability from
 * its assignment clause, the termination penalty from another, and the term end from a third. A
 * single `{fieldKey, page, excerpt}` on the document would force one citation per document and
 * quietly lose the others.
 *
 * `fieldKey` refers to a key in the item's own declared `fieldSchema`
 * (src/lib/templates/fieldSchema.ts), so citations are pinned to the same template version the
 * finding was rated against. A citation whose field no longer exists is dropped on read rather
 * than rendered against nothing.
 */

import { z } from "zod";

export const MAX_EXCERPT_LENGTH = 600;

const citationSchema = z.object({
  /** A key from the checklist item's declared fieldSchema. */
  fieldKey: z.string().min(1).max(60),
  /**
   * Where in the document — free text rather than a number, deliberately. Consultants cite what
   * the document actually gives them: "p.7", "§14.2", "Schedule B, item 4", "clause 9.1(b)".
   * Forcing a page number would make the common case ("§14.2") unrepresentable.
   */
  locator: z.string().trim().max(120).optional(),
  /**
   * The quoted text. This is what makes the citation checkable rather than merely locatable — a
   * reader can see whether the words support the rating without opening the file.
   */
  excerpt: z.string().trim().max(MAX_EXCERPT_LENGTH).optional(),
});

export const sourceRefSchema = z.object({ citations: z.array(citationSchema).max(24) });

export type Citation = z.infer<typeof citationSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;

/**
 * Read citations off a persisted `Evidence.sourceRef`.
 *
 * Fails closed and quietly: a malformed value yields no citations rather than throwing, because
 * the alternative is a consultant losing access to a whole audit page over one bad row.
 */
export function parseSourceRef(raw: unknown): Citation[] {
  if (raw == null) return [];
  const parsed = sourceRefSchema.safeParse(raw);
  return parsed.success ? parsed.data.citations : [];
}

export type EvidenceWithCitations = {
  id: string;
  text: string | null;
  label: string | null;
  sourceRef: unknown;
};

export type ResolvedCitation = Citation & {
  evidenceId: string;
  /** What to call the document in the report — the consultant's label, else the filename. */
  documentName: string;
};

/**
 * Collect every citation across a finding's documents, grouped by the field it substantiates.
 *
 * Only keys the schema still declares are returned: a citation against a field a later template
 * version removed would otherwise render attached to nothing.
 */
export function citationsByField(
  evidence: EvidenceWithCitations[],
  knownFieldKeys: ReadonlySet<string>,
): Map<string, ResolvedCitation[]> {
  const byField = new Map<string, ResolvedCitation[]>();

  for (const document of evidence) {
    const documentName = document.label ?? document.text ?? "document";
    for (const citation of parseSourceRef(document.sourceRef)) {
      if (!knownFieldKeys.has(citation.fieldKey)) continue;
      const existing = byField.get(citation.fieldKey) ?? [];
      existing.push({ ...citation, evidenceId: document.id, documentName });
      byField.set(citation.fieldKey, existing);
    }
  }

  return byField;
}

/**
 * One citation as a single line, for the report.
 *
 * Reads as a lawyer would write it: where, in what, saying what. The excerpt is quoted so a reader
 * can tell the consultant's words from the document's — which matters, because the whole value of
 * the line is that the document said it and not the consultant.
 */
export function formatCitation(citation: ResolvedCitation): string {
  const where = citation.locator ? `${citation.locator} of ${citation.documentName}` : citation.documentName;
  return citation.excerpt ? `${where}: “${citation.excerpt}”` : where;
}

/**
 * Apply an edit to a document's citations: replace every citation for one field, leaving citations
 * for other fields untouched.
 *
 * Field-scoped rather than wholesale so that correcting the transferability citation on a contract
 * cannot silently drop the penalty citation on the same contract — the two were recorded at
 * different times, probably weeks apart, and losing the older one would be invisible.
 */
export function withFieldCitation(
  existing: Citation[],
  fieldKey: string,
  citation: { locator?: string; excerpt?: string } | null,
): SourceRef {
  const others = existing.filter((entry) => entry.fieldKey !== fieldKey);
  if (!citation || (!citation.locator?.trim() && !citation.excerpt?.trim())) {
    // Both blank means "remove the citation for this field" — there is nothing left to point at.
    return { citations: others };
  }
  return {
    citations: [
      ...others,
      {
        fieldKey,
        ...(citation.locator?.trim() ? { locator: citation.locator.trim() } : {}),
        ...(citation.excerpt?.trim() ? { excerpt: citation.excerpt.trim() } : {}),
      },
    ],
  };
}
