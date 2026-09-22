/**
 * What each automated check can actually determine, against what its rubric promises.
 *
 * WHY THIS EXISTS
 * ---------------
 * An automated item has two statements of one rule: the Tier A runner that writes the rating, and
 * the template's `severityGuidance` that a consultant reads when deciding whether to accept it.
 * When they disagree the consultant follows the rubric and overrides a correct rating, or accepts a
 * rating the rubric would not have given. Template v5 corrected two such divergences — and shipped
 * while three more sat unexamined in the same template, because its scope was set by which ones
 * had been noticed rather than by a sweep.
 *
 * The three it missed were the same shape and worse than the two it caught. `runDnsFingerprint` and
 * `runMailProviderFingerprint` returned PASS/GREEN having identified a provider, while the rubric
 * reserves Green for accounts "the seller can demonstrate control of and that are on the asset
 * schedule". So a target whose DNS sat with an agency outside the sale — the rubric's own Red
 * condition — got the same confirmed Green as one where the seller had proved control, and a mail
 * tenant owned personally by a departing founder looked identical to one on the asset schedule.
 *
 * This is the registry that makes the sweep mandatory. Every runner must appear here, and an entry
 * that admits the rubric asks for more than the runner can see must point at the words in the
 * published template that say so. The test enforces both, so a new runner cannot be added without
 * the judgement being made, and a rubric cannot quietly stop stating a gap it still has.
 *
 * WHAT "STATES THE GAP" MEANS, AND WHY IT IS ENOUGH
 * ------------------------------------------------
 * Not every gap can be closed. Whether a seller can demonstrate control of an account is not
 * observable from public records by any means, and inventing a signal for it would be worse than
 * admitting the limit. What is not acceptable is silence: a PASS that a consultant and then a buyer
 * read as verification of something nobody verified. So a gap is resolved by being stated in the
 * rubric AND by the runner returning IN_PROGRESS rather than PASS, which makes the finding count as
 * awaiting confirmation in the coverage the report prints (spec.md §6).
 */

export type RubricAlignment = {
  automationKey: string;
  /** What the runner can establish on its own, from public records alone. */
  runnerDetermines: string;
  /**
   * What the rubric's Green additionally requires that no automated check can observe. Null means
   * the runner can reach the rubric's verdict unaided.
   */
  rubricRequiresBeyond: string | null;
  /**
   * A phrase that must appear in the published item's severity guidance where a gap exists. Checked
   * against the real template content, so this registry cannot drift into a list of good
   * intentions.
   */
  gapStatedBy: string | null;
  /**
   * What the runner returns on its clean path.
   *
   * Tied to the field above and asserted: a check that admits its rubric asks for more than it can
   * see must not report a finished PASS, because PASS is what the coverage count and the report
   * present as a rating somebody stood behind. IN_PROGRESS keeps the severity — what was observed
   * is genuinely unremarkable — while saying the rating is not finished.
   */
  successStatus: "PASS" | "IN_PROGRESS";
  reviewedOn: string;
};

export const RUBRIC_ALIGNMENTS: RubricAlignment[] = [
  {
    automationKey: "domain_whois",
    runnerDetermines:
      "Registrar, expiry, creation and last-transfer dates, EPP status codes and whether the registrant is public, from RDAP.",
    rubricRequiresBeyond:
      "The threshold is stated relative to the expected close date, and no close date exists in the data model — the runner measures 30/90 days from the audit date instead.",
    gapStatedBy: "WHAT THE AUTOMATED RATING MEASURED",
    successStatus: "IN_PROGRESS",
    reviewedOn: "2026-09-22",
  },
  {
    automationKey: "ssl_cert",
    runnerDetermines:
      "Chain validity, issuer, hostname match, and time remaining against the certificate's own lifetime.",
    // The one item where the automated verdict is genuinely complete: everything the rubric's
    // threshold turns on is in the certificate itself.
    rubricRequiresBeyond: null,
    gapStatedBy: null,
    successStatus: "PASS",
    reviewedOn: "2026-09-22",
  },
  {
    automationKey: "dns_hosting_fingerprint",
    runnerDetermines: "Which nameservers and A records the domain publishes, and the likely provider.",
    rubricRequiresBeyond:
      "Green requires accounts the seller can demonstrate control of and that are on the asset schedule; Red turns on DNS sitting with a party outside the transaction. Neither is observable from public records.",
    gapStatedBy: "confirm the seller controls the DNS account",
    successStatus: "IN_PROGRESS",
    reviewedOn: "2026-09-22",
  },
  {
    automationKey: "mail_provider_fingerprint",
    runnerDetermines: "The MX hosts and the likely mail provider.",
    rubricRequiresBeyond:
      "Green requires administrative control the seller can demonstrate, on an account on the asset schedule. A tenant owned personally by a departing founder is indistinguishable from public records.",
    gapStatedBy: "Confirm who administers the tenant",
    successStatus: "IN_PROGRESS",
    reviewedOn: "2026-09-22",
  },
  {
    automationKey: "https_hygiene",
    runnerDetermines: "Whether HTTP redirects to HTTPS, whether HTTPS is reachable, and the HSTS header.",
    rubricRequiresBeyond:
      "Green also requires no blockable mixed content on customer-facing pages and no TLS 1.0/1.1 offered by choice. The runner fetches one response and checks neither.",
    gapStatedBy: "does not load customer-facing pages to look for blockable mixed content",
    successStatus: "IN_PROGRESS",
    reviewedOn: "2026-09-22",
  },
  {
    automationKey: "email_auth_posture",
    runnerDetermines:
      "SPF, DMARC and best-effort DKIM records as published, and the effective DMARC enforcement policy.",
    rubricRequiresBeyond:
      "DKIM cannot be graded without a real message from the business's own sending system, and key length cannot be measured without one — the selector guess covers only common selectors.",
    gapStatedBy: "neither key length nor rotation can be measured without",
    successStatus: "IN_PROGRESS",
    reviewedOn: "2026-09-22",
  },
  {
    automationKey: "cms_fingerprint",
    runnerDetermines: "A platform signature from public response headers and markup.",
    rubricRequiresBeyond:
      "Green requires a maintained hosted service, and patch status cannot be inferred from a fingerprint. The runner never returns Green for this reason — it rates Yellow and asks.",
    gapStatedBy: "Reserve Red for something independently confirmed",
    successStatus: "IN_PROGRESS",
    reviewedOn: "2026-09-22",
  },
];

/** Every runner must have made this judgement. */
export function assertAlignmentCoverage(automationKeys: Iterable<string>): void {
  const recorded = new Set(RUBRIC_ALIGNMENTS.map((a) => a.automationKey));
  const missing = [...automationKeys].filter((key) => !recorded.has(key));
  if (missing.length > 0) {
    throw new Error(
      `No rubric-alignment judgement recorded for: ${missing.join(", ")}.\n` +
        "An automated check writes a rating a consultant reads a rubric to evaluate. Record what " +
        "the runner can determine and what the rubric asks for beyond it, in " +
        "src/lib/audit/rubricAlignment.ts — including 'nothing', which is a finding worth stating.",
    );
  }

  const unknown = [...recorded].filter((key) => ![...automationKeys].includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `Rubric alignments recorded for runners that no longer exist: ${unknown.join(", ")}. ` +
        "A judgement about a check that was removed protects nothing.",
    );
  }
}
