import { describe, expect, it } from "vitest";

import { TEMPLATE_DEFINITIONS } from "./content";
import { buildEvidenceBackedItems } from "./evidenceBackedThresholds";
import {
  V5_CHANGE_NOTE,
  applyEdits,
  assertEditCoverage,
  buildRunnerAlignedItems,
} from "./runnerAlignedThresholds";

const SLUG = TEMPLATE_DEFINITIONS[0].slug;
const SPECIFIC = TEMPLATE_DEFINITIONS[0].specificItems;

const v4 = buildEvidenceBackedItems(SLUG, SPECIFIC);
const v5 = buildRunnerAlignedItems(SLUG, SPECIFIC);
const item = (items: typeof v4, title: string) => items.find((i) => i.title === title)!;

const TLS = "SSL/TLS certificate validity, issuer, expiration";
const DOMAIN = "Domain and registrar ownership, expiration";

describe("what v5 changes", () => {
  it("replaces the proportion-only certificate rule with the shorter-of rule", () => {
    const before = item(v4, TLS).severityGuidance!;
    const after = item(v5, TLS).severityGuidance!;

    // v4's instruction was the defect: it told the consultant to rate on proportion alone, which
    // the runner does not do, on an item the runner rates automatically.
    expect(before).toContain("Rate on the proportion of lifetime remaining, not on a day count");
    expect(after).not.toContain("Rate on the proportion of lifetime remaining, not on a day count");
    expect(after).toContain("whichever window is SHORTER");
    expect(after).toContain("one third of lifetime OR 30 days");
    expect(after).toContain("one sixth OR 14 days");
  });

  it("keeps the sourced material v4 got right", () => {
    const after = item(v5, TLS).severityGuidance!;
    // The proportional half is real and cited; only the claim that it governs alone was wrong. A
    // revision that threw out the sourcing to fix the rule would lose the part a buyer's advisor
    // would actually check.
    for (const kept of ["Certbot", "RFC 9773", "six-day", "vendor folklore", "NIST SP 1800-16B"]) {
      expect(after, kept).toContain(kept);
    }
    // And the bands themselves are untouched — this revision corrects a threshold shape, not a
    // list of what counts as Red.
    expect(after).toContain("RED: certificate expired");
    expect(after.indexOf("RED:")).toBeGreaterThan(after.indexOf("SHORTER"));
  });

  it("says the automated domain rating cannot see the close date", () => {
    const before = item(v4, DOMAIN).severityGuidance!;
    const after = item(v5, DOMAIN).severityGuidance!;

    expect(before).not.toContain("WHAT THE AUTOMATED RATING MEASURED");
    expect(after).toContain("WHAT THE AUTOMATED RATING MEASURED");
    // The specific gap, stated in the consultant's terms rather than as a caveat.
    expect(after).toContain("measures from the audit date");
    expect(after).toContain("100 days");
    // It must not invent the date it does not have.
    expect(after).toContain("inventing a date the consultant has not given us");
  });

  it("leaves the v4 basis paragraph in place rather than replacing it", () => {
    const after = item(v5, DOMAIN).severityGuidance!;
    expect(after).toContain("SAC 010");
    expect(after).toContain("this firm's methodology choice, never as an industry standard");
  });
});

describe("what v5 leaves alone", () => {
  it("changes exactly two items and no others", () => {
    const changed = v5.filter(
      (after, i) => after.severityGuidance !== v4[i].severityGuidance,
    );
    expect(changed.map((c) => c.title).sort()).toEqual([DOMAIN, TLS].sort());
  });

  it("touches nothing but severityGuidance", () => {
    expect(v5).toHaveLength(v4.length);
    for (let i = 0; i < v5.length; i++) {
      const { severityGuidance: _a, ...restAfter } = v5[i];
      const { severityGuidance: _b, ...restBefore } = v4[i];
      expect(restAfter, v4[i].title).toEqual(restBefore);
    }
  });

  it("produces the same items for every template in the library", () => {
    for (const definition of TEMPLATE_DEFINITIONS) {
      const built = buildRunnerAlignedItems(definition.slug, definition.specificItems);
      const base = buildEvidenceBackedItems(definition.slug, definition.specificItems);
      expect(built.map((i) => i.title), definition.slug).toEqual(base.map((i) => i.title));
    }
  });

  it("is deterministic", () => {
    expect(buildRunnerAlignedItems(SLUG, SPECIFIC)).toEqual(buildRunnerAlignedItems(SLUG, SPECIFIC));
  });
});

describe("the edits refuse to apply to nothing", () => {
  it("rejects an item set that no longer carries an edited title", () => {
    // The failure this prevents is the quiet one: an edit whose anchor has moved matches nothing,
    // and the publish would then ship v4's content under a v5 change note — a version number
    // claiming a correction the content does not contain.
    expect(() => assertEditCoverage(["Some other item"])).toThrow(/does not produce/);
  });

  it("rejects a rubric whose anchor text has changed", () => {
    // Simulates v4 being reworded underneath this revision. The failure must be loud: an edit that
    // matches nothing silently publishes v4's content under a v5 change note.
    const reworded = { ...item(v4, TLS), severityGuidance: "Rewritten rubric with no anchor." };
    expect(() => applyEdits(reworded)).toThrow(/could not find its anchor/);
  });

  it("rejects an edited item that has lost its rubric entirely", () => {
    const stripped = { ...item(v4, DOMAIN), severityGuidance: undefined };
    expect(() => applyEdits(stripped)).toThrow(/carries no severity rubric/);
  });

  it("passes through an item it does not edit, unchanged and not copied wrongly", () => {
    const untouched = v4.find((i) => i.title !== TLS && i.title !== DOMAIN)!;
    expect(applyEdits(untouched)).toBe(untouched);
  });
});

describe("the change note", () => {
  it("names the correction rather than the version", () => {
    // releases.md §3 treats a template version as a release event; the note is what a consultant
    // sees when asked why two audits of the same business rated differently.
    expect(V5_CHANGE_NOTE).toContain("SHORTER");
    expect(V5_CHANGE_NOTE).toContain("45 days");
    expect(V5_CHANGE_NOTE).toContain("audit date");
    expect(V5_CHANGE_NOTE.length).toBeGreaterThan(200);
  });
});
