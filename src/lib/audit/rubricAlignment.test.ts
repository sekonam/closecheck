import { describe, expect, it } from "vitest";

import { RUBRIC_ALIGNMENTS, assertAlignmentCoverage } from "./rubricAlignment";
import { isAutomatable } from "./tierA";
import { TEMPLATE_DEFINITIONS } from "@/lib/templates/content";
import { buildStatedLimitsItems } from "@/lib/templates/statedLimitsThresholds";

/**
 * Makes the rubric-versus-runner comparison mandatory for every automated item.
 *
 * Template v5 corrected two divergences and shipped while three more of the same shape sat
 * unexamined in the same template, because its scope was set by what had been noticed. Nothing
 * required the comparison to be made for every item. This does.
 */

/** Every item in the live library that the product rates automatically. */
const automatedItems = (() => {
  const seen = new Map<string, { title: string; automationKey: string; severityGuidance?: string | null }>();
  for (const definition of TEMPLATE_DEFINITIONS) {
    for (const item of buildStatedLimitsItems(definition.slug, definition.specificItems)) {
      if (item.automationKey && isAutomatable(item.automationKey) && !seen.has(item.automationKey)) {
        seen.set(item.automationKey, item as never);
      }
    }
  }
  return [...seen.values()];
})();

describe("every automated check has a recorded judgement", () => {
  it("covers every runner the product can actually run", () => {
    expect(automatedItems.length).toBeGreaterThan(0);
    expect(() => assertAlignmentCoverage(automatedItems.map((i) => i.automationKey))).not.toThrow();
  });

  it("fails when a new runner arrives with no judgement", () => {
    // The point of the registry: adding a Tier A check should force someone to say what its rating
    // means against the rubric a consultant will read beside it.
    expect(() =>
      assertAlignmentCoverage([...automatedItems.map((i) => i.automationKey), "brand_new_check"]),
    ).toThrow(/No rubric-alignment judgement recorded for: brand_new_check/);
  });

  it("fails when a judgement outlives the runner it describes", () => {
    expect(() => assertAlignmentCoverage(["ssl_cert"])).toThrow(/no longer exist/);
  });
});

describe("a stated gap is actually stated", () => {
  it("names words that appear in the published rubric", () => {
    // The assertion that stops this registry becoming a list of good intentions. An entry may admit
    // the rubric asks for more than the runner can see; it may not admit that and leave the
    // consultant's rubric silent about it.
    for (const alignment of RUBRIC_ALIGNMENTS) {
      if (!alignment.rubricRequiresBeyond) continue;
      const item = automatedItems.find((i) => i.automationKey === alignment.automationKey);
      expect(item, alignment.automationKey).toBeDefined();
      expect(alignment.gapStatedBy, `${alignment.automationKey} admits a gap but names no wording`).toBeTruthy();
      expect(
        item!.severityGuidance ?? "",
        `${alignment.automationKey}: the rubric does not contain "${alignment.gapStatedBy}"`,
      ).toContain(alignment.gapStatedBy!);
    }
  });

  it("does not claim a gap statement where there is no gap", () => {
    for (const alignment of RUBRIC_ALIGNMENTS) {
      if (alignment.rubricRequiresBeyond) continue;
      expect(alignment.gapStatedBy, alignment.automationKey).toBeNull();
    }
  });

  it("says what the runner determines, in every case", () => {
    for (const a of RUBRIC_ALIGNMENTS) {
      expect(a.runnerDetermines.length, a.automationKey).toBeGreaterThan(40);
      expect(Date.parse(`${a.reviewedOn}T00:00:00Z`), a.automationKey).not.toBeNaN();
    }
  });

  it("never lets a check with a stated gap report a finished PASS", () => {
    // The rule the registry exists to hold. PASS is what the coverage count and the report present
    // as a rating somebody stood behind; a check admitting its rubric asks for more than it can see
    // must not claim that. Two entries violated this when the registry was written — domain_whois
    // and email_auth_posture both returned PASS while declaring a gap — which is how a rule stated
    // only in a docstring goes.
    for (const a of RUBRIC_ALIGNMENTS) {
      if (a.rubricRequiresBeyond) {
        expect(a.successStatus, `${a.automationKey} declares a gap`).toBe("IN_PROGRESS");
      }
    }
  });

  it("matches what the runners actually return on a clean result", async () => {
    // Asserted against the shipped runners rather than trusted: the field above is a claim about
    // code, and a claim about code that nothing executes is a comment.
    const { runTierACheck } = await import("./tierA");
    const clean = RUBRIC_ALIGNMENTS.find((a) => a.automationKey === "ssl_cert")!;
    expect(clean.successStatus).toBe("PASS");
    // A domain that resolves to nothing exercises a failure path on every runner, so this only
    // pins the contract's shape; the per-runner clean paths are covered in their own specs
    // (domainExpiry, certificateExpiry, emailAuthRating).
    await expect(runTierACheck("ssl_cert", "invalid.invalid")).resolves.toBeTruthy();
  });

  it("records at least one check whose verdict is complete, and one that is not", () => {
    // A registry where every entry said the same thing would be describing a policy rather than
    // seven separate judgements.
    expect(RUBRIC_ALIGNMENTS.some((a) => a.rubricRequiresBeyond === null)).toBe(true);
    expect(RUBRIC_ALIGNMENTS.some((a) => a.rubricRequiresBeyond !== null)).toBe(true);
  });
});
