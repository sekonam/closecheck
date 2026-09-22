/**
 * The standard liability/disclaimer language every generated report includes (docs/spec.md §6).
 * Single source of truth so the exact text a consultant reviews and acknowledges on the settings
 * page (src/lib/actions/org.ts's acknowledgeDisclaimer) is byte-identical to what actually ships in
 * every PDF (src/lib/reports/renderHtml.ts) — nothing to drift out of sync between the two.
 *
 * Changing this string is a legal-content change, not a routine content edit (spec.md §6) — flag it
 * for review rather than editing directly, per the spec-writing skill.
 *
 * CHANGED ONCE, DELIBERATELY, ON 2026-09-22, and the reasoning belongs here rather than only in a
 * commit. The previous text singled out Tier C as "consultant-attested observations, not automated
 * verifications", which invited the reader to take everything else as verified. Template v6
 * established that most Tier A checks cannot reach the verdict their own rubric describes — they
 * read public records and cannot establish who controls an account — so the sentence was drawing a
 * line in the wrong place in the one paragraph a buyer's counsel actually reads. The document
 * already carried the information per finding and in the rating summary; the disclaimer was the
 * last place still implying otherwise.
 *
 * A wording change also invalidates every prior acknowledgment, by design.
 * `ConsultantOrg.disclaimerAcknowledgedAt` means "this org's owner reviewed the disclaimer text as
 * it read on that date" and nothing else, so the change must reset the column rather than let a
 * stale acknowledgment stand for language nobody read — migration
 * 20260922214500_disclaimer_scope_of_automated_checks does that.
 *
 * Which is why it was made NOW. Exactly one organisation had acknowledged the previous text and it
 * was a development org, so the reset cost nothing. The same edit after the first paying firm is a
 * re-acknowledgement cycle for every one of them.
 */
export const REPORT_DISCLAIMER_TEXT =
  "This report reflects information available as of the date generated above. It is not a substitute for legal, financial, or tax due diligence. Findings are based on the tier methodology described to the client separately; Tier C findings are consultant-attested observations, not automated verifications. A finding shown as in progress carries a rating the consultant has not confirmed, and the rating summary states how many; automated checks read public records and cannot establish who controls an account.";
