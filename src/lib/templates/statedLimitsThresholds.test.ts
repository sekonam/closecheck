import { describe, expect, it } from "vitest";

import { TEMPLATE_DEFINITIONS } from "./content";
import { buildRunnerAlignedItems } from "./runnerAlignedThresholds";
import { V6_CHANGE_NOTE, applyEdits, buildStatedLimitsItems } from "./statedLimitsThresholds";

const SLUG = TEMPLATE_DEFINITIONS[0].slug;
const SPECIFIC = TEMPLATE_DEFINITIONS[0].specificItems;
const v5 = buildRunnerAlignedItems(SLUG, SPECIFIC);
const v6 = buildStatedLimitsItems(SLUG, SPECIFIC);
const item = (items: typeof v5, title: string) => items.find((i) => i.title === title)!;

const DNS = "DNS provider and hosting fingerprint";
const MAIL = "Mail provider fingerprint";
const HTTPS = "HTTPS hygiene";
const EMAIL = "Email authentication posture (SPF / DMARC; DKIM best-effort)";

describe("what v6 states that v5 left silent", () => {
  it("says the DNS check cannot see the control its Green requires", () => {
    const after = item(v6, DNS).severityGuidance!;
    expect(item(v5, DNS).severityGuidance!).not.toContain("WHAT THE AUTOMATED CHECK COVERED");
    expect(after).toContain("confirm the seller controls the DNS account");
    // The specific trap: the rubric's own Red condition is invisible to the runner.
    expect(after).toContain("An agency or developer holding the zone looks exactly like the seller");
  });

  it("says a founder-owned mail tenant looks identical from public records", () => {
    const after = item(v6, MAIL).severityGuidance!;
    expect(after).toContain("Confirm who administers the tenant");
    expect(after).toContain("owned personally by a departing founder");
  });

  it("says what the HTTPS check did not load", () => {
    const after = item(v6, HTTPS).severityGuidance!;
    expect(after).toContain("does not load customer-facing pages to look for blockable mixed content");
    expect(after).toContain("does not enumerate the TLS versions");
  });

  it("resolves the HSTS contradiction rather than leaving a case in no band", () => {
    // v5 said Green requires HSTS and, two sentences later, that a missing HSTS header is not on
    // its own a Yellow — so redirect-without-HSTS belonged to neither band and two consultants
    // rating the same finding by the same rubric could disagree.
    const before = item(v5, HTTPS).severityGuidance!;
    const after = item(v6, HTTPS).severityGuidance!;
    expect(before).toContain("is worth noting but is not on its own a Yellow");
    expect(after).not.toContain("is worth noting but is not on its own a Yellow");
    expect(after).toContain("Green with HSTS absent is therefore available");
  });

  it("says DKIM cannot be graded from DNS alone", () => {
    const after = item(v6, EMAIL).severityGuidance!;
    expect(after).toContain("neither key length nor rotation can be measured without");
    expect(after).toContain("unguessable selector");
    // Keeps the sourced grading material that is still correct for a consultant with a message.
    expect(after).toContain("RFC 8301");
  });
});

describe("what v6 leaves alone", () => {
  it("changes exactly the four items it claims", () => {
    const changed = v6
      .filter((after, i) => after.severityGuidance !== v5[i].severityGuidance)
      .map((c) => c.title)
      .sort();
    expect(changed).toEqual([DNS, EMAIL, HTTPS, MAIL].sort());
  });

  it("touches nothing but severityGuidance", () => {
    const bare = (i: (typeof v5)[number]) => ({ ...i, severityGuidance: null });
    expect(v6).toHaveLength(v5.length);
    for (let i = 0; i < v6.length; i++) expect(bare(v6[i]), v5[i].title).toEqual(bare(v5[i]));
  });

  it("is deterministic and applies across the whole library", () => {
    for (const d of TEMPLATE_DEFINITIONS) {
      const a = buildStatedLimitsItems(d.slug, d.specificItems);
      const b = buildStatedLimitsItems(d.slug, d.specificItems);
      expect(a, d.slug).toEqual(b);
      expect(a.map((i) => i.title)).toEqual(buildRunnerAlignedItems(d.slug, d.specificItems).map((i) => i.title));
    }
  });
});

describe("the edits refuse to apply to nothing", () => {
  it("throws when an anchor has moved", () => {
    const reworded = { ...item(v5, DNS), severityGuidance: "Rewritten, no anchor." };
    expect(() => applyEdits(reworded)).toThrow(/could not find its anchor/);
  });

  it("passes an unedited item through untouched", () => {
    const untouched = v5.find((i) => ![DNS, MAIL, HTTPS, EMAIL].includes(i.title))!;
    expect(applyEdits(untouched)).toBe(untouched);
  });
});

describe("the change note", () => {
  it("names what changed about an automated pass", () => {
    expect(V6_CHANGE_NOTE).toContain("asset schedule");
    expect(V6_CHANGE_NOTE).toContain("in progress");
    expect(V6_CHANGE_NOTE).toContain("HSTS");
  });
});
