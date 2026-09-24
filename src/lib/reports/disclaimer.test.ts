import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REPORT_DISCLAIMER_TEXT } from "./disclaimer";

/**
 * The disclaimer is the one paragraph in the deliverable that is legal content rather than a
 * finding, and its whole design is that the text a consultant acknowledges is byte-identical to the
 * text that ships. These hold both halves of that.
 */

describe("what the disclaimer states", () => {
  it("says a rating shown as in progress has not been confirmed", () => {
    // Added when template v6 established that most Tier A checks cannot reach the verdict their own
    // rubric describes. Until then the paragraph singled out Tier C as "not automated
    // verifications", which invited a reader to take everything else as verified.
    expect(REPORT_DISCLAIMER_TEXT).toContain("in progress carries a rating the consultant has not confirmed");
  });

  it("says what an automated check cannot establish, not merely that it is automated", () => {
    // "Automated" alone reads as a strength. The limit that matters to a buyer is specific: these
    // checks read public records, and control of an account is not in public records.
    expect(REPORT_DISCLAIMER_TEXT).toContain("cannot establish who controls an account");
  });

  it("keeps the Tier C attestation statement, which is still true", () => {
    expect(REPORT_DISCLAIMER_TEXT).toContain("consultant-attested observations");
  });

  it("promises nothing and disclaims what it always did", () => {
    expect(REPORT_DISCLAIMER_TEXT).toContain("not a substitute for legal, financial, or tax due diligence");
    // A disclaimer that guarantees something is not a disclaimer.
    expect(REPORT_DISCLAIMER_TEXT).not.toMatch(/\bguarantee|\bwarrant|\bcertif/i);
  });
});

describe("one source of truth", () => {
  it("is the only literal — the settings page and the renderer both import it", () => {
    // The module's central claim: the text a consultant reviews and acknowledges on the settings
    // page is the same bytes that ship in every PDF. A second copy of this sentence anywhere would
    // silently break that, and the acknowledgment would then attest to language nobody shipped.
    const sentence = "It is not a substitute for legal, financial, or tax due diligence.";
    for (const file of [
      "src/lib/reports/renderHtml.ts",
      "src/app/(app)/settings/page.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not inline the disclaimer`).not.toContain(sentence);
      expect(source, `${file} must import REPORT_DISCLAIMER_TEXT`).toContain("REPORT_DISCLAIMER_TEXT");
    }
  });
});

describe("the legal-review tripwire", () => {
  /**
   * spec.md §6 says changing this language "is a legal-review item, not a routine content edit —
   * flag it rather than edit it directly". That was a commitment with nothing enforcing it: the
   * instruction lived in a docstring and in the spec, and both rely on whoever edits the string
   * happening to read them first. This is the mechanism.
   *
   * Pinning the hash does not prevent a change and is not meant to. It makes the change
   * DELIBERATE — you cannot alter the sentence a buyer's counsel reads without also coming here,
   * which is the moment to remember the two things most easily forgotten.
   */
  it("has not changed without someone acknowledging what changing it means", () => {
    const pinned = "ad9264889739591a5c24e4cc99da9bf9f0362b58f138d1947671acdcb4f22bfb";
    const actual = createHash("sha256").update(REPORT_DISCLAIMER_TEXT, "utf8").digest("hex");

    expect(
      actual,
      "The report disclaimer has changed.\n\n" +
        "This is a legal-review item (spec.md §6), not a content edit. Before updating the hash " +
        "below, two things have to happen and both have been missed before:\n\n" +
        "  1. The wording is reviewed by someone qualified to review it. 'No longer false' is a " +
        "lower bar than 'the language this firm wants to stand behind'.\n" +
        "  2. A migration clears ConsultantOrg.disclaimerAcknowledgedAt. That column means 'this " +
        "owner reviewed the text as it read on that date' and nothing else, so leaving it set " +
        "records an acknowledgement of language nobody read — worse than no acknowledgement. See " +
        "20260922214500_disclaimer_scope_of_automated_checks for the precedent.\n\n" +
        "Then set the pinned hash to the value below. Note the cost of this change rises with " +
        "adoption: clearing the column blocks report generation for every firm until an owner " +
        "re-acknowledges, which on a live deployment is a simultaneous interruption to all of them.",
    ).toBe(pinned);
  });

  it("pins the text itself, not a description of it", () => {
    // A tripwire keyed on length, or on a phrase, would pass through a rewording that preserved
    // either — which is exactly the kind of change most needing review.
    expect(createHash("sha256").update("nearly the same text", "utf8").digest("hex")).not.toBe(
      createHash("sha256").update("nearly the same text.", "utf8").digest("hex"),
    );
  });
});
