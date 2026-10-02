"use client";

/**
 * Keeps a refused save from destroying what the consultant just typed.
 *
 * Every form on the audit page is a plain server-action form, which is what makes this surface work
 * on a broker's guest wifi with no hydration (see StructuredFields.tsx). The cost of that choice is
 * that a REFUSAL is a redirect to `?error=…`, i.e. a fresh server render of the last *saved*
 * values — so anything typed in the refused submission exists only in the DOM. On the data-export
 * item that is eleven structured fields of careful transcription, held by nothing, and a reload or
 * a restored tab takes all of it because a Red rating was missing its note.
 *
 * So: on submit, stash the form's values; on an `?error=` load, put back the stash belonging to
 * the finding the server named. One listener for the whole page rather than a wrapper per form, so
 * the 24 finding forms stay server-rendered markup and nothing about the no-JS path changes. If
 * this component never loads, or sessionStorage throws, the page behaves exactly as it did before.
 *
 * Deliberately NOT a validation layer. The server owns the rules ("A Red finding needs a note"),
 * and tests/integration/e2e/b-findings-evidence.itest.ts row B5 drives the UI into that server
 * refusal on purpose — a client-side block would stop the submit from ever happening and hang it.
 */

import { useEffect } from "react";

/** Namespaced so a stray key in a shared sessionStorage can never be mistaken for a draft. */
const KEY_PREFIX = "closecheck:finding-draft:";

/** Every sessionStorage access is wrapped: it throws outright in some privacy modes. */
function readDraft(key: string): Record<string, string> | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, values: Record<string, string>): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* Out of quota or blocked: the draft is a safety net, never a prerequisite. */
  }
}

/**
 * A load with no `?error=` means the last submission was accepted (or the consultant arrived
 * fresh): server state is authoritative and every draft is now older than it, so the whole lot
 * goes. Drafts are only ever dropped here, never on the error load itself — see the effect.
 */
function dropAllDrafts(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) stale.push(key);
    }
    for (const key of stale) window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The hidden findingId is what identifies a finding-scoped form; it is not part of the draft. */
function findingIdOf(form: HTMLFormElement): string | null {
  const field = form.elements.namedItem("findingId");
  return field instanceof HTMLInputElement && field.value ? field.value : null;
}

function isSkippable(control: Control): boolean {
  if (!(control instanceof HTMLInputElement)) return false;
  // A file input's value cannot be set from script at all (and should not be: the bytes are gone
  // after a redirect either way, so the consultant has to re-pick the file regardless).
  return control.type === "file" || control.type === "submit" || control.type === "button";
}

function serialise(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    const control = element as Control;
    const name = control.name;
    if (!name || name === "findingId" || isSkippable(control)) continue;
    if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
      // No finding form carries one today. Recorded anyway so that adding one later is a visible
      // behaviour change rather than a silent hole in the safety net.
      values[name] = control.checked ? control.value || "on" : "";
      continue;
    }
    values[name] = control.value;
  }
  return values;
}

function restore(form: HTMLFormElement, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement) {
      if (isSkippable(field)) continue;
      if (field.type === "checkbox" || field.type === "radio") field.checked = value !== "";
      else field.value = value;
    } else if (field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      // A select whose option no longer exists lands on "", which is the honest outcome: the
      // template version changed under the consultant and that answer no longer exists.
      field.value = value;
    }
  }
}

function findingForms(): HTMLFormElement[] {
  const forms: HTMLFormElement[] = [];
  for (const input of Array.from(document.querySelectorAll('input[name="findingId"]'))) {
    const form = (input as HTMLInputElement).form;
    if (form && !forms.includes(form)) forms.push(form);
  }
  return forms;
}

export function FindingDraftKeeper() {
  useEffect(() => {
    // Runs in an effect, i.e. after hydration has committed, so nothing here races React putting
    // the server-rendered defaultValues onto the controls.
    //
    // This is the HARD-LOAD path: the refusal itself is a client-side navigation, and React keeps
    // uncontrolled inputs' DOM values across one of those, so the typed work is still on screen
    // without any help from here. What this covers is the load after that — a reload, a restored
    // tab, a back-navigation onto the error URL — which is where the transcription actually went
    // missing, and which is also the one the consultant reaches for when a page looks wrong.
    const params = new URLSearchParams(window.location.search);
    // ONLY the finding the server named as the failure is ever restored. Any other stored draft
    // belongs to a submission that already completed, so putting one back could only overwrite
    // saved work with older text — which is why they are dropped rather than applied.
    const failed = params.has("error") ? params.get("finding") : null;
    if (failed) {
      const draft = readDraft(KEY_PREFIX + failed);
      const form = findingForms().find((candidate) => findingIdOf(candidate) === failed);
      if (draft && form) restore(form, draft);
      // Deliberately NOT dropped here. The consultant's next move on a page that refused them is
      // often to reload it, and a draft consumed on first read would make that reload the thing
      // that finally loses the transcription. It is dropped on the next load that is not an error
      // — i.e. as soon as a save has actually been accepted.
    } else {
      dropAllDrafts();
    }

    // Capture phase on `document`: React's own form-action handling listens on the root container,
    // below this, so the stash is written before the action is dispatched.
    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const id = findingIdOf(form);
      if (!id) return;
      writeDraft(KEY_PREFIX + id, serialise(form));
    };
    document.addEventListener("submit", onSubmit, true);

    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  return null;
}
