/**
 * Template v5 — "say what the product actually does".
 *
 * WHAT THIS REVISION IS FOR
 * -------------------------
 * v4 gave several items sourced severity rubrics. Two of them describe a judgement the automated
 * Tier A check cannot make, and say nothing about that — so the rubric a consultant reads and the
 * rating the product writes disagree, on the same item, in the same audit. Both divergences were
 * found by running the checks against live domains and comparing the output to the rubric, not by
 * reading either.
 *
 * 1. **TLS certificate threshold shape.** v4 says "rate on the proportion of lifetime remaining,
 *    not on a day count" and calls the day-count convention vendor folklore. The runner applies
 *    whichever window is SHORTER: one third of lifetime, capped at 30 days, for the renewal band,
 *    and one sixth capped at 14 for the overdue band. Measured live: toasttab.com serving a
 *    395-day certificate with 105 days left rates Green, while v4's rubric puts Yellow at 132 days
 *    — so a consultant following the published rubric would override a correct rating.
 *
 *    The runner is right and the rubric is wrong. A pure proportional rule is correct for the
 *    short-lived automated certificates it was written for and wrong for long-lived manual ones: a
 *    valid DigiCert certificate on quickbooks.intuit.com with 45 days to run rated Red under it,
 *    and §6's worst-item reduction turns an entire audit Red for a target doing nothing wrong.
 *    The cap exists for that case; the proportion exists so a six-day certificate with two days
 *    left is not permanently Red. Each governs where the other fails.
 *
 * 2. **Domain expiry is close-relative in the rubric and cannot be in the runner.** v4 puts Yellow
 *    at "expiry within expected close plus 90 days". There is no expected-close date in the data
 *    model — `Engagement` carries a `dealStage` and no date — so the runner measures 30/90 days
 *    from the audit date instead. For a deal closing in six months, a domain expiring in 100 days
 *    is Green from the runner and Yellow by the rubric. This revision does not invent a date; it
 *    states what the automated rating measured, so the consultant knows what they still have to do.
 *
 * WHY THIS IS A TEMPLATE VERSION AND NOT AN EDIT
 * ---------------------------------------------
 * Changing what a threshold *means* is exactly what `Audit.templateId`'s hard FK exists for
 * (spec.md §5, releases.md §3). An audit rated against v4's proportional rule must keep reading
 * against that rule — the report a buyer holds cites the methodology in force when it was written,
 * and silently re-basing it would make the document disagree with itself.
 *
 * HOW THE EDITS ARE EXPRESSED
 * ---------------------------
 * As anchored find-and-replace against v4's text rather than retyped rubrics. A v5 that restated
 * four thousand characters would make the actual change unreviewable in a diff and would silently
 * drop any v4 wording it forgot. Every edit asserts it matched, so a change to v4's text fails at
 * authoring time instead of quietly applying to nothing.
 */

import type { TemplateItemInput } from "./publish";
import { buildEvidenceBackedItems } from "./evidenceBackedThresholds";

export const V5_CHANGE_NOTE =
  "v5 — aligns two Tier A severity rubrics with what the automated check actually computes. The " +
  "certificate threshold is the SHORTER of a proportion of lifetime and a day cap, not proportion " +
  "alone: proportion alone rated a one-year certificate with 45 days left Red, and a day count " +
  "alone rates every six-day certificate Red. The domain-expiry rubric now says the automated " +
  "rating measures from the audit date rather than from the expected close, because no close date " +
  "exists in the data model — the consultant still has to re-read it against the real one.";

type Edit = { find: string; replace: string };

const CERT_THRESHOLD_SHAPE_OLD =
  "Rate on the proportion of lifetime remaining, not on a day count. The 30/14/7 convention is " +
  "vendor folklore:";

const CERT_THRESHOLD_SHAPE_NEW =
  "Rate on whichever window is SHORTER: a proportion of the certificate's own lifetime, or a fixed " +
  "number of days. Renewal is due inside one third of lifetime OR 30 days, whichever comes first; " +
  "it is overdue inside one sixth OR 14 days. In practice that means the proportion governs any " +
  "certificate shorter than about 90 days and the day cap governs everything longer.\n\nBOTH HALVES " +
  "ARE LOAD-BEARING, and this is the correction v5 makes to v4. A proportional rule alone is right " +
  "for the short-lived automated certificates it was written for and wrong for long-lived manual " +
  "ones: one third of a one-year certificate is four months, so a perfectly healthy certificate " +
  "with 45 days to run rates Red — measured on a live DigiCert certificate at a major SaaS vendor " +
  "— and the worst-item roll-up then turns an entire audit Red for a target doing nothing wrong. A " +
  "day count alone fails the other way, rating every six-day certificate Red for its whole life. " +
  "The shorter-of rule is what the product's automated check applies, and a consultant overriding " +
  "a Green rating on a long-dated certificate because a proportional reading said Yellow would be " +
  "correcting the product towards the wrong answer.\n\nThe proportional half is not this firm's " +
  "invention: the 30/14/7 convention is vendor folklore —";

const DOMAIN_EXPIRY_SCOPE_NOTE =
  "\n\nWHAT THE AUTOMATED RATING MEASURED, AND WHAT IT COULD NOT. The threshold above is stated " +
  "relative to the expected close date. The automated check cannot apply it that way: there is no " +
  "expected-close date anywhere in an engagement's record, so it measures from the audit date and " +
  "rates Red under 30 days and Yellow under 90. For a deal closing soon those coincide. For a deal " +
  "six months out they do not — a domain expiring in 100 days rates Green automatically and is " +
  "Yellow under this rubric, and only you know which. Re-read every Green on this item against the " +
  "real close date before you rely on it, and say in the finding which date you measured from. " +
  "This gap is stated rather than closed because closing it would mean inventing a date the " +
  "consultant has not given us.";

const EDITS: Record<string, Edit[]> = {
  "SSL/TLS certificate validity, issuer, expiration": [
    { find: CERT_THRESHOLD_SHAPE_OLD, replace: CERT_THRESHOLD_SHAPE_NEW },
  ],
  "Domain and registrar ownership, expiration": [
    // Appended rather than substituted: the existing basis paragraph is correct and sourced, and
    // what was missing is that the automated rating cannot apply it.
    { find: "Present it as this firm's methodology choice, never as an industry standard.",
      replace: "Present it as this firm's methodology choice, never as an industry standard." + DOMAIN_EXPIRY_SCOPE_NOTE },
  ],
};

/**
 * Applies this revision's edits to one item.
 *
 * Exported so a test can drive the anchor failure directly. The guarantee worth testing is that a
 * reworded v4 rubric fails loudly here rather than publishing v4's content under a v5 change note,
 * and that is only observable one item at a time.
 */
export function applyEdits(item: TemplateItemInput): TemplateItemInput {
  const edits = EDITS[item.title];
  if (!edits) return item;
  if (!item.severityGuidance) {
    throw new Error(`Template v5 edits "${item.title}", which carries no severity rubric to edit.`);
  }

  let guidance = item.severityGuidance;
  for (const { find, replace } of edits) {
    if (!guidance.includes(find)) {
      throw new Error(
        `Template v5 could not find its anchor in "${item.title}":\n  ${find.slice(0, 120)}…\n` +
          "The v4 text changed underneath this revision. Re-read the rubric and re-anchor the edit " +
          "— an edit that matches nothing applies nothing, and would publish v4's content as v5.",
      );
    }
    guidance = guidance.replace(find, replace);
  }
  return { ...item, severityGuidance: guidance };
}

/** Every title v5 edits must exist in the v4 build, for the same reason v4 checks against v3. */
export function assertEditCoverage(v4Titles: Iterable<string>): void {
  const known = new Set(v4Titles);
  const orphans = Object.keys(EDITS).filter((title) => !known.has(title));
  if (orphans.length > 0) {
    throw new Error(
      `Template v5 edits items that v4 does not produce: ${orphans.join("; ")}. The title changed ` +
        "or the item was retired — an edit keyed to nothing applies to nothing.",
    );
  }
}

/** Builds the full v5 item set for one template slug. */
export function buildRunnerAlignedItems(
  slug: string,
  specificItems: TemplateItemInput[],
): TemplateItemInput[] {
  const v4 = buildEvidenceBackedItems(slug, specificItems);
  assertEditCoverage(v4.map((item) => item.title));
  return v4.map(applyEdits);
}
