import { describe, expect, it } from "vitest";

import { TEMPLATE_DEFINITIONS, BASE_TEMPLATE_ITEMS } from "./content";
import { buildEvidenceDepthItems } from "./evidenceDepth";
import { assertThresholdCoverage, buildEvidenceBackedItems } from "./evidenceBackedThresholds";
import { assertClientFacingDescriptions, assertPublishableItems } from "./publish";
import { parseFieldSchema } from "./fieldSchema";

const BUILT = TEMPLATE_DEFINITIONS.map((definition) => ({
  slug: definition.slug,
  name: definition.name,
  items: buildEvidenceBackedItems(definition.slug, definition.specificItems),
}));

const RESTAURANT = BUILT[0].items;

function item(title: string) {
  const found = RESTAURANT.find((candidate) => candidate.title === title);
  if (!found) throw new Error(`No v4 item titled "${title}"`);
  return found;
}

/** Guidance + severity rubric of one item, which is where every threshold in this revision lives. */
function rubric(title: string) {
  const found = item(title);
  return `${found.guidance ?? ""}\n${found.severityGuidance ?? ""}`;
}

describe("v4 template content", () => {
  it("has a threshold decision for every item carried forward from v3", () => {
    // The failure this guards is specific to what v4 is: guidance written from domain knowledge
    // goes stale silently, and an item nobody re-read against the evidence base looks exactly like
    // one that was re-read and deliberately left alone.
    expect(() => assertThresholdCoverage()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Every v3 invariant still holds
  // -------------------------------------------------------------------------

  for (const template of BUILT) {
    describe(template.name, () => {
      it("passes the publish-time invariants", () => {
        expect(() => assertPublishableItems(template.items, template.slug)).not.toThrow();
      });

      it("leaks no product internals into client-facing descriptions", () => {
        expect(() => assertClientFacingDescriptions(template.items, template.slug)).not.toThrow();
      });

      it("gives every manual item both a verification procedure and a severity rubric", () => {
        const thin = template.items.filter(
          (entry) => entry.method === "MANUAL" && (!entry.guidance || !entry.severityGuidance),
        );
        expect(thin.map((entry) => entry.title)).toEqual([]);
      });

      it("declares a valid field schema wherever it declares one at all", () => {
        for (const entry of template.items) {
          if (!entry.fieldSchema) continue;
          expect(parseFieldSchema(entry.fieldSchema), `${entry.title}`).not.toBeNull();
        }
      });

      it("never puts a field schema on an automated item", () => {
        const clashing = template.items.filter(
          (entry) => entry.method === "AUTOMATED" && entry.fieldSchema,
        );
        expect(clashing.map((entry) => entry.title)).toEqual([]);
      });

      it("asks the customer-facing platform's transferability separately from the core system's", () => {
        const asksTransferability = template.items.filter(
          (entry) =>
            entry.tier === "B" &&
            entry.title !== "Primary business-system contract terms, term length, early-termination penalty" &&
            (entry.fieldSchema?.fields ?? []).some((field) => field.key === "transferable"),
        );
        expect(asksTransferability.map((entry) => entry.title).length).toBeGreaterThan(0);
      });

      it("has at least one Tier C live-access item", () => {
        expect(template.items.filter((entry) => entry.tier === "C").length).toBeGreaterThan(0);
      });

      it("expects a document on every Tier B item and an attestation on every Tier C item", () => {
        for (const entry of template.items) {
          if (entry.tier === "B") expect(entry.evidenceExpectation, entry.title).toBe("DOCUMENT");
          if (entry.tier === "C") expect(entry.evidenceExpectation, entry.title).toBe("ATTESTATION");
        }
      });

      it("declares the blocking dependency each tier implies", () => {
        for (const entry of template.items) {
          const expected =
            entry.tier === "A" ? "NONE" : entry.tier === "B" ? "SELLER_DOCUMENTS" : "LIVE_ACCESS";
          expect(entry.blockingDependency ?? "NONE", entry.title).toBe(expected);
        }
      });

      it("captures something structured on every Tier B and Tier C item", () => {
        const unstructured = template.items.filter(
          (entry) => (entry.tier === "B" || entry.tier === "C") && !entry.fieldSchema,
        );
        expect(unstructured.map((entry) => entry.title)).toEqual([]);
      });

      it("keeps the v3 split of the bundled live-login item", () => {
        const titles = template.items.map((entry) => entry.title);
        expect(titles).not.toContain("Live login to POS/booking/GBP/socials");
        expect(titles).toContain("Live login to the primary operating system");
        expect(titles).toContain("Live login to listing and social accounts");
      });

      it("carries the three universal items this revision adds", () => {
        const titles = template.items.map((entry) => entry.title);
        expect(titles).toContain("Authentication verdicts on a real message from the business's sending system");
        expect(titles).toContain("Terminated-merchant file (MATCH / VMSS) exposure");
        expect(titles).toContain("Processing continuity at close");
      });
    });
  }

  it("orders items by sortOrder", () => {
    for (const template of BUILT) {
      const orders = template.items.map((entry) => entry.sortOrder);
      expect(orders, template.slug).toEqual([...orders].sort((a, b) => a - b));
    }
  });

  it("is deterministic across builds", () => {
    const first = buildEvidenceBackedItems("salon-booking", TEMPLATE_DEFINITIONS[1].specificItems);
    const second = buildEvidenceBackedItems("salon-booking", TEMPLATE_DEFINITIONS[1].specificItems);
    expect(first).toEqual(second);
  });

  it("leaves the frozen v1/v2 and v3 content untouched", () => {
    // Every earlier version is pinned by audits already rated against it (docs/spec.md §5). v4 must
    // be additive — if revising ever mutated the arrays it builds on, every historical version's
    // text would silently move with it.
    const bundled = BASE_TEMPLATE_ITEMS.find(
      (entry) => entry.title === "Live login to POS/booking/GBP/socials",
    );
    expect(bundled?.guidance).toBeUndefined();

    const v3Tls = buildEvidenceDepthItems("restaurant-online-ordering", []).find(
      (entry) => entry.title === "SSL/TLS certificate validity, issuer, expiration",
    );
    // The defect v4 corrects is still present in v3, which is the point of a new version.
    expect(v3Tls?.severityGuidance).toContain("expires inside 30 days");
  });

  // -------------------------------------------------------------------------
  // The corrected thresholds are present
  // -------------------------------------------------------------------------

  describe("TLS certificate posture", () => {
    const text = rubric("SSL/TLS certificate validity, issuer, expiration");

    it("drops the fixed 30-day expiry rule", () => {
      expect(text).not.toContain("expires inside 30 days");
      expect(text).not.toMatch(/Yellow if it expires inside \d+ days/);
    });

    it("rates on the proportional renewal norm and names its sources", () => {
      expect(text).toContain("one third of the lifetime");
      expect(text).toContain("Certbot");
      expect(text).toContain("Let's Encrypt");
    });

    it("carries the ratified validity schedule rather than the superseded 398-day cap", () => {
      expect(text).toContain("200 days");
      expect(text).toContain("15 March 2027");
      expect(text).toContain("CA/Browser Forum Baseline Requirements");
      // 398 days survives only as the reason not to flag a long-dated certificate issued before
      // the cap dropped — never as the current maximum.
      expect(text).not.toMatch(/(maximum|cap(ped)?|limit)[^.]*398/);
      expect(text).toMatch(/issued before 15 March 2026 can legitimately carry a 398-day life/);
    });

    it("says plainly that no days-to-expiry standard exists", () => {
      expect(text).toMatch(/No standards body publishes a days-to-expiry risk threshold/i);
    });

    it("keeps the expiry-email withdrawal, which is the dated question worth asking", () => {
      expect(text).toContain("4 June 2025");
    });
  });

  describe("payment processor standing", () => {
    const text = rubric("Payment processor account standing");

    it("names the retired Visa programmes only in order to retire them", () => {
      // The acronyms stay, once, because a consultant will meet them in a seller's own paperwork
      // and needs to know they are dead. What must never survive is either of them standing as a
      // live threshold, or the 0.9%/100-dispute numbers being rated against.
      expect(text).toMatch(/retired VDMP and VFMP on 1 April 2025/);
      expect((text.match(/VDMP|VFMP/g) ?? []).length).toBe(2);
      expect(text).toMatch(/0\.9%-and-100-disputes figures that still circulate are the retired/);
      expect(text).not.toMatch(/(Red|Yellow|Green)[^.]*0\.9%/);
    });

    it("states VAMP's published merchant threshold, its floor, and its effective date", () => {
      expect(text).toContain("150 bps");
      expect(text).toContain("1,500");
      expect(text).toContain("1 April 2026");
      expect(text).toContain("Visa Acquirer Monitoring Program");
    });

    it("states Mastercard's ECM thresholds and its previous-month denominator", () => {
      expect(text).toContain("100–299 chargebacks");
      expect(text).toContain("preceding month");
      expect(text).toContain("50 bps"); // the Excessive Fraud Merchant threshold, not 1.5%
      expect(text).not.toContain("1.5% fraud");
    });

    it("refuses to state a reserve percentage as a rule", () => {
      expect(text).toMatch(/no authoritative source publishes 'standard' reserve percentages/i);
      expect(text).toContain("vendor convention");
    });

    it("tells the consultant to re-verify the programme thresholds at the audit date", () => {
      expect(text).toMatch(/re-verify at the audit date/i);
    });

    it("captures both networks' ratios rather than one undifferentiated chargeback rate", () => {
      const keys = (item("Payment processor account standing").fieldSchema?.fields ?? []).map(
        (field) => field.key,
      );
      expect(keys).toContain("vampRatio");
      expect(keys).toContain("mcCtrLagged");
      expect(keys).toContain("mcCtrSameMonth");
    });
  });

  describe("terminated-merchant file exposure", () => {
    const text = rubric("Terminated-merchant file (MATCH / VMSS) exposure");

    it("carries MATCH Code 04's actual trigger and its durability", () => {
      expect(text).toContain("1% of monthly Mastercard sales");
      expect(text).toContain("USD 5,000");
      expect(text).toContain("five years");
      expect(text).toContain("principal");
    });

    it("rates a refusal to represent as Red", () => {
      expect(text).toMatch(/declining to make the representation/i);
    });

    it("kills the 'letter of good standing' as an obtainable instrument", () => {
      expect(rubric("Terminated-merchant file (MATCH / VMSS) exposure")).toMatch(
        /not a defined card-network instrument/i,
      );
    });
  });

  describe("trademark conflict scan", () => {
    const text = rubric("Trademark conflict scan on business name / domain");

    it("no longer rates on the Nice class", () => {
      expect(text).not.toMatch(/similar(ity)? only matters within the same class/i);
      expect(text).not.toMatch(/Red if a registered mark .* in the same class/i);
      expect(text).toContain("has no bearing on the question of likelihood of confusion");
      expect(text).toContain("TMEP §1207.01(d)(v)");
    });

    it("names the current search system and classification edition", () => {
      expect(text).toContain("NCL 13-2026");
      expect(text).toContain("Trademark Search");
      expect(text).toContain("30 November 2023"); // TESS retirement, stated as history not as tooling
    });

    it("carries the non-attorney line the consultant needs", () => {
      expect(text).toContain("37 C.F.R. §11.14(b)");
      expect(text).toMatch(/avoid the words infringe/i);
    });

    it("records the class as a fact and the overlap as the finding", () => {
      const fields = item("Trademark conflict scan on business name / domain").fieldSchema?.fields ?? [];
      const conflicts = fields.find((field) => field.key === "conflictsFound");
      expect(conflicts?.options).toContain("similar-overlapping-goods");
      expect(conflicts?.options ?? []).not.toContain("similar-same-class");
      expect(fields.map((field) => field.key)).toContain("classesRecorded");
    });
  });

  describe("email authentication", () => {
    const text = rubric("Email authentication posture (SPF / DMARC; DKIM best-effort)");

    it("cites the current DMARC RFC, and the old one only as obsoleted", () => {
      expect(text).toContain("RFC 9989");
      expect(text).toMatch(/obsoletes RFC 7489/);
      expect((text.match(/RFC 7489/g) ?? []).length).toBe(1);
    });

    it("attributes the 5,000/day threshold to Google and Microsoft only", () => {
      expect(text).toContain("Google and Microsoft each publish a 5,000-messages-per-day");
      expect(text).toMatch(/Yahoo publishes no numeric threshold/i);
    });

    it("keeps DKIM out of the rating on guessed selectors", () => {
      expect(text).toMatch(/DKIM NEVER LOWERS THIS RATING ON ITS OWN/);
      expect(text).toContain("not evidence of absence");
    });

    it("grounds 'p=none is not Green' in a published directive", () => {
      expect(text).toContain("Binding Operational Directive 18-01");
    });

    it("grades DKIM on a real message, with the artifact as required evidence", () => {
      const testMessage = item("Authentication verdicts on a real message from the business's sending system");
      expect(testMessage.tier).toBe("A");
      expect(testMessage.evidenceExpectation).toBe("DOCUMENT");
      const keys = (testMessage.fieldSchema?.fields ?? []).map((field) => field.key);
      expect(keys).toContain("dkimSelector");
      expect(keys).toContain("dkimKeyBits");
      expect(keys).toContain("authResults");
      expect(testMessage.severityGuidance).toContain("RFC 8301");
    });
  });

  describe("domain registration posture", () => {
    const text = rubric("Domain and registrar ownership, expiration");

    it("keeps the 60-day transfer lock as currently in force", () => {
      expect(text).toContain("60 days");
      expect(text).toContain("2026.06.07.04");
      expect(text).toMatch(/not in force/i);
      expect(text).toMatch(/re-verify at the audit date/i);
    });

    it("labels the expiry threshold as this firm's own basis, not an industry standard", () => {
      expect(text).toMatch(/No published standard exists/i);
      expect(text).toContain("close date plus 90 days");
      expect(text).toContain("SAC 010");
      expect(text).toMatch(/never as an industry standard/i);
    });

    it("publishes no invented registrar restore fee", () => {
      expect(text).toMatch(/no ICANN cap on restore fees/i);
      expect(text).not.toMatch(/\$\d{2,}/);
    });

    it("keeps RDAP, not WHOIS, as the source of record", () => {
      expect(text).toContain("RDAP");
      expect(text).toContain("21 August 2025");
    });
  });

  describe("data export", () => {
    const text = rubric("Data-export test");

    it("captures contactable count separately from row count", () => {
      const keys = (item("Data-export test").fieldSchema?.fields ?? []).map((field) => field.key);
      expect(keys).toContain("customerRowCount");
      expect(keys).toContain("contactableCount");
      expect(keys).toContain("postCloseAccessWindow");
      expect(keys).toContain("accountTransferPath");
      expect(keys).toContain("earliestRecordDate");
    });

    it("carries the masked-contact finding that makes a customer count misleading", () => {
      expect(text).toMatch(/masks the contact details/i);
      expect(text).toMatch(/overstates the contactable list/i);
    });

    it("carries the post-closure window that makes extraction a pre-close condition", () => {
      expect(text).toContain("60 days after the account is closed");
      expect(text).toContain("48 months");
      expect(text).toMatch(/pre-close condition/i);
    });

    it("uses the portability benchmark as a yardstick, not as a right the seller can compel", () => {
      expect(text).toContain("structured, commonly used and machine-readable");
      expect(text).toMatch(/right of the individual data subject, not of the business/i);
      expect(text).toContain("§1798.130");
    });

    it("says plainly that no M&A export standard exists", () => {
      expect(text).toMatch(/no published M&A standard/i);
    });
  });

  // -------------------------------------------------------------------------
  // Nothing anywhere asserts a standard the research says does not exist
  // -------------------------------------------------------------------------

  it("never claims an industry standard for certificate-expiry alerting or domain expiry", () => {
    for (const template of BUILT) {
      for (const entry of template.items) {
        const text = `${entry.guidance ?? ""}\n${entry.severityGuidance ?? ""}`;
        expect(text, entry.title).not.toMatch(/industry standard is to alert/i);
        expect(text, entry.title).not.toMatch(/the industry standard for (domain|certificate) expiry/i);
      }
    }
  });

  it("never reintroduces a retired programme, tool or edition anywhere in the content", () => {
    const retired = [
      "TESS is", // the tool presented as current, as opposed to the dated fact that it was retired
      "12th edition",
      "Mail Check", // retired 31 March 2026 — must not be cited as a live tool
    ];
    for (const template of BUILT) {
      for (const entry of template.items) {
        const text = `${entry.description ?? ""}\n${entry.guidance ?? ""}\n${entry.severityGuidance ?? ""}`;
        for (const phrase of retired) {
          expect(text, `${entry.title} / ${phrase}`).not.toContain(phrase);
        }
        // A retired programme or RFC may be named, but only in the act of retiring it.
        if (/VDMP|VFMP/.test(text)) {
          expect(text, entry.title).toMatch(/retired VDMP and VFMP/);
        }
        if (/RFC 7489/.test(text)) {
          expect(text, entry.title).toMatch(/obsoletes RFC 7489/);
        }
      }
    }
  });
});
