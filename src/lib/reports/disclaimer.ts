/**
 * The standard liability/disclaimer language every generated report includes (docs/spec.md §6).
 * Single source of truth so the exact text a consultant reviews and acknowledges on the settings
 * page (src/lib/actions/org.ts's acknowledgeDisclaimer) is byte-identical to what actually ships in
 * every PDF (src/lib/reports/renderHtml.ts) — nothing to drift out of sync between the two.
 *
 * Changing this string is a legal-content change, not a routine content edit (spec.md §6) — flag it
 * for review rather than editing directly, per the spec-writing skill. Changing it also invalidates
 * every org's prior acknowledgment by design: ConsultantOrg.disclaimerAcknowledgedAt only means "this
 * org's owner reviewed the disclaimer text as it read on that date," so any wording change should
 * reset the field (e.g. via a migration) rather than silently letting a stale acknowledgment stand
 * for language nobody actually reviewed.
 */
export const REPORT_DISCLAIMER_TEXT =
  "This report reflects information available as of the date generated above. It is not a substitute for legal, financial, or tax due diligence. Findings are based on the tier methodology described to the client separately; Tier C findings are consultant-attested observations, not automated verifications.";
