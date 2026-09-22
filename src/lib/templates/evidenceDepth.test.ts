import { describe, expect, it } from "vitest";

import { TEMPLATE_DEFINITIONS, BASE_TEMPLATE_ITEMS } from "./content";
import { assertEnrichmentCoverage, buildEvidenceDepthItems } from "./evidenceDepth";
import { assertClientFacingDescriptions, assertPublishableItems } from "./publish";
import { parseFieldSchema } from "./fieldSchema";

const BUILT = TEMPLATE_DEFINITIONS.map((definition) => ({
  slug: definition.slug,
  name: definition.name,
  items: buildEvidenceDepthItems(definition.slug, definition.specificItems),
}));

describe("v3 template content", () => {
  it("has guidance for every carried-forward item", () => {
    // Guards the failure mode that produced v2's five unstructured Tier B items: adding a checklist
    // item and never deciding how to verify it or when it's Red.
    expect(() => assertEnrichmentCoverage()).not.toThrow();
  });

  for (const template of BUILT) {
    describe(template.name, () => {
      it("passes the publish-time invariants", () => {
        expect(() => assertPublishableItems(template.items, template.slug)).not.toThrow();
      });

      it("leaks no product internals into client-facing descriptions", () => {
        // `description` renders verbatim into the whitelabeled PDF the buyer reads. v1/v2 carried
        // four literal "spec.md §N" references into that deliverable.
        expect(() => assertClientFacingDescriptions(template.items, template.slug)).not.toThrow();
      });

      it("gives every manual item both a verification procedure and a severity rubric", () => {
        const thin = template.items.filter(
          (item) => item.method === "MANUAL" && (!item.guidance || !item.severityGuidance),
        );
        expect(thin.map((item) => item.title)).toEqual([]);
      });

      it("declares a valid field schema wherever it declares one at all", () => {
        for (const item of template.items) {
          if (!item.fieldSchema) continue;
          expect(parseFieldSchema(item.fieldSchema), `${item.title}`).not.toBeNull();
        }
      });

      it("never puts a field schema on an automated item", () => {
        // structuredData doubles as the Tier A runner's output store — a form over the same column
        // would let a save erase check results.
        const clashing = template.items.filter((item) => item.method === "AUTOMATED" && item.fieldSchema);
        expect(clashing.map((item) => item.title)).toEqual([]);
      });

      it("asks the customer-facing platform's transferability separately from the core system's", () => {
        // docs/spec.md §4's base Tier B table lists platform-contract transferability as a
        // universal item, distinct from the core business-system contract. v2 expressed it only as
        // the restaurant's online-ordering contract and the salon's booking contract, so franchise
        // and e-commerce silently had no such item — the exact failure the audit-methodology skill
        // warns about ("putting a universal item into one template's list means every other
        // template silently lacks it").
        //
        // Asserted on the declared field schema rather than the item's title: matching titles by
        // regex is precisely the fragile coupling v3 removes, and each vertical words this item in
        // its own language ("online-ordering", "booking software", "storefront").
        const asksTransferability = template.items.filter(
          (item) =>
            item.tier === "B" &&
            item.title !== "Primary business-system contract terms, term length, early-termination penalty" &&
            (item.fieldSchema?.fields ?? []).some((field) => field.key === "transferable"),
        );
        expect(asksTransferability.map((item) => item.title).length).toBeGreaterThan(0);
      });

      it("has at least one Tier C live-access item", () => {
        // The salon template shipped with none, for a business whose whole value is a client list
        // living inside a booking platform.
        const tierC = template.items.filter((item) => item.tier === "C");
        expect(tierC.length).toBeGreaterThan(0);
      });

      it("expects a document on every Tier B item and an attestation on every Tier C item", () => {
        for (const item of template.items) {
          if (item.tier === "B") expect(item.evidenceExpectation, item.title).toBe("DOCUMENT");
          if (item.tier === "C") expect(item.evidenceExpectation, item.title).toBe("ATTESTATION");
        }
      });

      it("declares the blocking dependency each tier implies", () => {
        for (const item of template.items) {
          const expected =
            item.tier === "A" ? "NONE" : item.tier === "B" ? "SELLER_DOCUMENTS" : "LIVE_ACCESS";
          expect(item.blockingDependency ?? "NONE", item.title).toBe(expected);
        }
      });

      it("captures something structured on every Tier B and Tier C item", () => {
        // This is the whole point of v3: a document-backed or live-access finding whose only
        // record is one free-text line is the behaviour spec.md §4 names as insufficient.
        const unstructured = template.items.filter(
          (item) => (item.tier === "B" || item.tier === "C") && !item.fieldSchema,
        );
        expect(unstructured.map((item) => item.title)).toEqual([]);
      });

      it("retires the bundled live-login item in favour of the split pair", () => {
        const titles = template.items.map((item) => item.title);
        expect(titles).not.toContain("Live login to POS/booking/GBP/socials");
        expect(titles).toContain("Live login to the primary operating system");
        expect(titles).toContain("Live login to listing and social accounts");
      });
    });
  }

  it("leaves the frozen v1 content untouched", () => {
    // v1/v2 arrays are pinned by already-rated audits (docs/spec.md §5). v3 must be additive —
    // if enriching ever mutated the shared base array in place, every version would silently move.
    const bundled = BASE_TEMPLATE_ITEMS.find(
      (item) => item.title === "Live login to POS/booking/GBP/socials",
    );
    expect(bundled).toBeDefined();
    expect(bundled?.guidance).toBeUndefined();
    expect(BASE_TEMPLATE_ITEMS.every((item) => item.fieldSchema === undefined)).toBe(true);
  });

  it("is deterministic across builds", () => {
    const first = buildEvidenceDepthItems("salon-booking", TEMPLATE_DEFINITIONS[1].specificItems);
    const second = buildEvidenceDepthItems("salon-booking", TEMPLATE_DEFINITIONS[1].specificItems);
    expect(first).toEqual(second);
  });

  it("orders items by sortOrder", () => {
    for (const template of BUILT) {
      const orders = template.items.map((item) => item.sortOrder);
      expect(orders, template.slug).toEqual([...orders].sort((a, b) => a - b));
    }
  });
});
