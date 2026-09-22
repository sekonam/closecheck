import { describe, expect, it } from "vitest";

import { CheckMethod, Tier } from "@prisma/client";

import { buildEvidenceDepthItems } from "./evidenceDepth";
import type { TemplateItemInput } from "./publish";

/**
 * The template registries are keyed by item title, and `in` walks the prototype chain.
 *
 * `RETIRED_ITEMS`, `ENRICHMENTS`, `REVISIONS` and `UNCHANGED_FROM_V3` are plain object literals, so
 * `"constructor" in RETIRED_ITEMS` was true — and an item whose title happened to be an inherited
 * Object property was **silently dropped from the published template**. No error, no coverage
 * failure: `enrich` returns null for a retired item and the build filters nulls, so the checklist a
 * consultant works through would simply be one item shorter than the one that was authored.
 *
 * Found by an executable version of a rule this project already had in prose, after the same class
 * appeared twice by accident. Titles are product-authored, so reachability is low — which is the
 * same argument that failed three times in one day, and the fix is one lookup.
 */

const item = (title: string, sortOrder: number): TemplateItemInput => ({
  tier: Tier.A,
  method: CheckMethod.MANUAL,
  title,
  description: `${title} — client-facing description.`,
  sortOrder,
});

describe("template registries look up own properties only", () => {
  it("does not silently drop an item whose title is an inherited Object property", () => {
    // Each is a real name on Object.prototype, so each was treated as retired.
    for (const title of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
      const built = buildEvidenceDepthItems("restaurant-online-ordering", [item(title, 9001)]);
      expect(
        built.map((i) => i.title),
        `an item titled "${title}" must survive the build`,
      ).toContain(title);
    }
  });

  it("does not enrich such an item with content meant for something else", () => {
    // The mirror of the same bug: `ENRICHMENTS[item.title]` on a prototype key returns a function
    // rather than an enrichment, and spreading it would corrupt the item.
    const [built] = buildEvidenceDepthItems("restaurant-online-ordering", [item("constructor", 9002)])
      .filter((i) => i.title === "constructor");
    expect(built.description).toBe("constructor — client-facing description.");
    expect(built.tier).toBe("A");
  });

  it("still drops an item that is genuinely retired", () => {
    // The control. A fix that stopped dropping anything would satisfy both cases above while
    // reinstating the bundled live-login item v3 deliberately split.
    const built = buildEvidenceDepthItems("restaurant-online-ordering", []);
    expect(built.map((i) => i.title)).not.toContain("Live login to POS/booking/GBP/socials");
  });

  it("still carries an ordinary specific item through", () => {
    const built = buildEvidenceDepthItems("restaurant-online-ordering", [item("An ordinary item", 9003)]);
    expect(built.map((i) => i.title)).toContain("An ordinary item");
  });
});
