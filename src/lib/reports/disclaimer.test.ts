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
