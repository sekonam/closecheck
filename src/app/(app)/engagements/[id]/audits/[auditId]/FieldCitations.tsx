/**
 * Where each structured claim came from, and the control for recording it.
 *
 * A consultant fills in "Transferable: no" from a clause they just read. This is where they say
 * which clause — so the report can print "Transferable: No — §14.2, p.7 of toast-msa-2023.pdf:
 * 'This Agreement may not be assigned…'" instead of an unsupported assertion.
 *
 * Deliberately placed with the FIELDS rather than with the documents. The consultant's mental
 * model at this moment is "I just answered this question, here's where the answer came from", not
 * "let me annotate a PDF" — and the same document usually answers several questions from different
 * clauses, which a per-document annotation UI makes awkward to express.
 *
 * Server component, no client JS, consistent with the rest of the audit-taking surface.
 */

import type { ItemFieldSchema } from "@/lib/templates/fieldSchema";
import { formatCitation, type ResolvedCitation } from "@/lib/audit/sourceRef";

type DocumentOption = { id: string; name: string };

/**
 * Rendered as its own block BELOW the finding's form, never inside it. The cite control is itself
 * a form, and a form nested in a form is invalid HTML that browsers resolve by dropping the inner
 * one — so this has to sit outside even though it reads as belonging to the fields.
 */
export function FieldSources({
  schema,
  citations,
  documents,
  citeAction,
}: {
  schema: ItemFieldSchema;
  citations: Map<string, ResolvedCitation[]>;
  documents: DocumentOption[];
  citeAction: (formData: FormData) => Promise<void>;
}) {
  const citable = schema.fields.filter((field) => field.kind !== "table");
  const anyCitations = citable.some((field) => (citations.get(field.key) ?? []).length > 0);

  // Nothing to cite from and nothing cited: a document picker with no documents in it reads as a
  // broken control rather than a missing prerequisite.
  if (documents.length === 0 && !anyCitations) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Where these answers came from
      </div>
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {citable.map((field) => (
          <FieldCitation
            key={field.key}
            fieldKey={field.key}
            label={field.label}
            citations={citations.get(field.key) ?? []}
            documents={documents}
            citeAction={citeAction}
          />
        ))}
      </div>
    </div>
  );
}

function FieldCitation({
  fieldKey,
  label,
  citations,
  documents,
  citeAction,
}: {
  fieldKey: string;
  label: string;
  citations: ResolvedCitation[];
  documents: DocumentOption[];
  citeAction: (formData: FormData) => Promise<void>;
}) {
  if (documents.length === 0) {
    return citations.length === 0 ? null : (
      <div className="text-xs text-slate-500">
        <span className="font-medium text-slate-600">{label}</span>
        {citations.map((citation, index) => (
          <div key={index}>↳ {formatCitation(citation)}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      {citations.map((citation, index) => (
        <div key={index} className="text-slate-500">
          ↳ {formatCitation(citation)}
        </div>
      ))}

      <details>
        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-700">
          {citations.length > 0 ? "Change source" : "Cite a source"}
        </summary>
        <form action={citeAction} className="mt-1 space-y-1 rounded-md bg-slate-50 p-2">
          <input type="hidden" name="fieldKey" value={fieldKey} />
          <select
            name="evidenceId"
            defaultValue={citations[0]?.evidenceId ?? documents[0].id}
            className="block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.name}
              </option>
            ))}
          </select>
          <input
            name="locator"
            defaultValue={citations[0]?.locator ?? ""}
            // Free text, not a page number: consultants cite what the document gives them, and
            // "§14.2" is far more common than "page 7" in an executed agreement.
            placeholder="Where — e.g. §14.2, p.7, Schedule B"
            className="block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <textarea
            name="excerpt"
            defaultValue={citations[0]?.excerpt ?? ""}
            rows={2}
            placeholder="Quote the words that support this — a reader should be able to judge without opening the file"
            className="block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Save source
          </button>
          <p className="text-xs text-slate-400">
            Clearing both fields removes the source for this answer.
          </p>
        </form>
      </details>
    </div>
  );
}
