import { describe, expect, it } from "vitest";

import {
  POLICY_WATCHES,
  assertWatchCoverage,
  consultantNoticesFor,
  overdueWatches,
  scheduledValueAt,
} from "./policyWatch";
import { TEMPLATE_DEFINITIONS } from "./content";
import { buildEvidenceBackedItems } from "./evidenceBackedThresholds";

/**
 * The enforcement half of the dated-threshold mechanism (see policyWatch.ts).
 *
 * The first case is the one that matters: it is the maintenance commitment itself, expressed as
 * something that can fail. docs/spec.md §12 asked who re-verifies the dated thresholds and on what
 * cadence, and the honest answer to "who remembers" is nobody — so this remembers instead.
 */

describe("the review commitment", () => {
  it("has not lapsed on any watched fact", () => {
    const overdue = overdueWatches(new Date());
    expect(
      overdue.map((w) => `\n  ${w.key} — review was due ${w.reviewBy}\n    ${w.whatToCheck}\n    ${w.source}`).join(""),
      "A watched fact is past its review date. Re-read it against the primary source above, then " +
        "update verifiedOn and reviewBy — or change the threshold if it moved. Do not simply push " +
        "the date out: the point of this failing is that the checklist is making a dated claim " +
        "nobody has re-read.",
    ).toBe("");
  });

  it("fails once a review date passes, rather than merely recording one", () => {
    // The assertion above passes today by construction, so on its own it would prove nothing about
    // whether the mechanism actually bites. This pins the comparison: every entry is overdue when
    // read from far enough in the future.
    const farFuture = new Date("2099-01-01T00:00:00.000Z");
    expect(overdueWatches(farFuture)).toHaveLength(POLICY_WATCHES.length);
  });

  it("treats the review date as UTC, so a build's timezone cannot move it a day", () => {
    const watch = POLICY_WATCHES.find((w) => w.key === "icann-transfer-policy")!;
    const midnightUtc = new Date(`${watch.reviewBy}T00:00:00.000Z`);
    expect(overdueWatches(midnightUtc)).not.toContain(watch);
    expect(overdueWatches(new Date(midnightUtc.getTime() + 1))).toContain(watch);
  });

  it("gives every watch a source, a verification date and something to check", () => {
    for (const watch of POLICY_WATCHES) {
      expect(watch.source, watch.key).toMatch(/^https:\/\/|^docs\//);
      expect(Date.parse(`${watch.verifiedOn}T00:00:00Z`), watch.key).not.toBeNaN();
      // "Re-verify this" is what the template prose already said and is exactly the instruction
      // that cannot be acted on by someone picking it up cold.
      expect(watch.whatToCheck.length, watch.key).toBeGreaterThan(80);
    }
  });

  it("reviews a fact before the next change it knows about lands", () => {
    // A scheduled step that arrives after the review date would be fine — the product resolves it —
    // but a review date set beyond a step implies nobody looks at the entry until after the thing
    // it predicts has already happened, which is how a schedule quietly stops matching reality.
    for (const watch of POLICY_WATCHES) {
      const next = watch.schedule?.find((s) => Date.parse(s.effectiveFrom) > Date.now());
      if (!next) continue;
      expect(
        Date.parse(watch.reviewBy) <= Date.parse(next.effectiveFrom),
        `${watch.key}: reviewBy ${watch.reviewBy} is after the next scheduled change ${next.effectiveFrom}`,
      ).toBe(true);
    }
  });
});

describe("scheduled facts resolve themselves", () => {
  const at = (iso: string) => scheduledValueAt("cabforum-certificate-lifetime", new Date(iso));

  it("returns the value in force on the audit date", () => {
    expect(at("2026-09-22T00:00:00Z")).toBe("200 days");
  });

  it("returns the right value years out, with nobody touching it", () => {
    // The reason SCHEDULED is a separate kind: this is the whole maintenance burden for this fact,
    // and it is already discharged.
    expect(at("2027-03-15T00:00:00Z")).toBe("100 days");
    expect(at("2028-06-01T00:00:00Z")).toBe("100 days");
    expect(at("2029-03-15T00:00:00Z")).toBe("47 days");
    expect(at("2035-01-01T00:00:00Z")).toBe("47 days");
  });

  it("is inclusive of the effective date itself", () => {
    expect(at("2027-03-14T23:59:59Z")).toBe("200 days");
    expect(at("2027-03-15T00:00:00Z")).toBe("100 days");
  });

  it("returns null before the first step, and for an unknown or unscheduled key", () => {
    expect(at("2019-01-01T00:00:00Z")).toBeNull();
    expect(scheduledValueAt("icann-transfer-policy", new Date())).toBeNull();
    expect(scheduledValueAt("no-such-watch", new Date())).toBeNull();
  });
});

describe("what reaches the consultant", () => {
  it("tells them about a change nobody can date", () => {
    const notices = consultantNoticesFor("Domain and registrar ownership, expiration");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("7 June 2026");
    expect(notices[0]).toContain("60-day");
  });

  it("says what may have moved and what to do, not 'verify this'", () => {
    // The failure mode being designed against is the template prose this replaces: "RE-VERIFY AT
    // THE AUDIT DATE" tells a consultant they have a problem and nothing about what it is.
    for (const notice of consultantNoticesFor("Domain and registrar ownership, expiration")) {
      expect(notice).toMatch(/Confirm|Check|apply/);
      expect(notice.length).toBeGreaterThan(120);
    }
  });

  it("stays silent on facts that resolve themselves", () => {
    expect(consultantNoticesFor("SSL/TLS certificate validity, issuer, expiration")).toEqual([]);
  });

  it("stays silent on facts we hold rather than hand over", () => {
    // DATED_READING is a commitment enforced by the review test above. Surfacing it would put a
    // notice on most of the checklist, which is how a consultant learns to scroll past the one
    // notice that is load-bearing.
    for (const title of [
      "Payment processor account standing",
      "Data-export test",
      "Trademark conflict scan on business name / domain",
      "Platform account ownership and transfer mechanics",
    ]) {
      expect(consultantNoticesFor(title), title).toEqual([]);
    }
  });

  it("gives every consultant-facing kind a notice, and no other kind one", () => {
    for (const watch of POLICY_WATCHES) {
      const hasNotice = typeof watch.consultantNotice === "string";
      expect(hasNotice, watch.key).toBe(watch.kind === "ADOPTED_UNDATED");
    }
  });

  it("returns nothing for an item with no watch", () => {
    expect(consultantNoticesFor("Recurring SaaS inventory")).toEqual([]);
  });
});

describe("watches stay attached to real checklist items", () => {
  it("names only items that exist in the live template library", () => {
    // Built from the real definitions, the way the publish script does — including each template's
    // own specific items. An earlier version of this test passed `[]` for the specific items and
    // reported three salon and e-commerce watches as orphans, which is the same false alarm a
    // careless fix would have created by deleting them.
    const titles = new Set(
      TEMPLATE_DEFINITIONS.flatMap((definition) =>
        buildEvidenceBackedItems(definition.slug, definition.specificItems).map((i) => i.title),
      ),
    );
    expect(() => assertWatchCoverage(titles)).not.toThrow();
  });

  it("refuses an orphaned watch rather than passing quietly", () => {
    expect(() => assertWatchCoverage(["Some unrelated item"])).toThrow(/do not exist/);
  });

  it("has no duplicate keys", () => {
    const keys = POLICY_WATCHES.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
