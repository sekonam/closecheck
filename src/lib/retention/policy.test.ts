import { DealStage } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_POST_CLOSE_RETENTION_DAYS,
  TERMINAL_DEAL_STAGES,
  appendixRetentionSentence,
  defaultPurgeDateFor,
  resolvePurgeDate,
} from "./policy";

const NOW = new Date("2026-09-22T12:00:00.000Z");

describe("defaultPurgeDateFor", () => {
  it("schedules a purge once a deal reaches a terminal stage", () => {
    for (const stage of TERMINAL_DEAL_STAGES) {
      const purgeAt = defaultPurgeDateFor(stage, NOW);
      expect(purgeAt, stage).not.toBeNull();
      expect(purgeAt?.toISOString()).toBe("2026-12-21T12:00:00.000Z");
    }
  });

  it("schedules nothing while a deal is still live", () => {
    // Documents are still in use during diligence — an in-flight engagement must not acquire a
    // purge date behind the consultant's back.
    for (const stage of [DealStage.PRE_LOI, DealStage.POST_LOI, DealStage.CLOSING]) {
      expect(defaultPurgeDateFor(stage, NOW), stage).toBeNull();
    }
  });

  it("uses the stated retention window", () => {
    const purgeAt = defaultPurgeDateFor(DealStage.DEAD, NOW);
    const days = Math.round((purgeAt!.getTime() - NOW.getTime()) / 86_400_000);
    expect(days).toBe(DEFAULT_POST_CLOSE_RETENTION_DAYS);
  });

  it("does not mutate the date it is given", () => {
    const now = new Date(NOW);
    defaultPurgeDateFor(DealStage.CLOSED, now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });

  it("crosses month and year boundaries correctly", () => {
    // setUTCDate past the end of the month rolls over; the arithmetic must not depend on the
    // server's local zone, which is why this is UTC throughout (the database is pinned to UTC for
    // the same reason — see the pin_database_timezone_utc migration).
    const purgeAt = defaultPurgeDateFor(DealStage.CLOSED, new Date("2026-11-15T23:30:00.000Z"));
    expect(purgeAt?.toISOString()).toBe("2027-02-13T23:30:00.000Z");
  });
});

describe("resolvePurgeDate", () => {
  const NINETY_DAYS_ON = "2026-12-21T12:00:00.000Z";

  it("fills the default on a terminal engagement that has no date", () => {
    expect(
      resolvePurgeDate({ targetStage: DealStage.DEAD, submitted: null, existing: null, now: NOW })?.toISOString(),
    ).toBe(NINETY_DAYS_ON);
  });

  it("fills the default on an engagement that was ALREADY terminal", () => {
    // The transition-based version missed exactly this population — every engagement already
    // CLOSED or DEAD when the change shipped kept indefinite retention, which is the group the
    // change was written for.
    expect(
      resolvePurgeDate({ targetStage: DealStage.CLOSED, submitted: null, existing: null, now: NOW }),
    ).not.toBeNull();
  });

  it("fills the default moving between two terminal stages", () => {
    // CLOSED → DEAD is terminal-to-terminal; the transition-based version wrote null here.
    expect(
      resolvePurgeDate({ targetStage: DealStage.DEAD, submitted: null, existing: null, now: NOW }),
    ).not.toBeNull();
  });

  it("clears the date when a deal is revived", () => {
    // The dangerous case. A deal marked DEAD gets an auto-filled date; two weeks later it revives
    // and the form re-submits that stored date from its prefilled input. The purge job selects on
    // the date alone with no stage filter, so leaving it set would delete the seller's contracts
    // out of a live diligence engagement — from a date the consultant never typed.
    const stale = new Date("2026-11-01T00:00:00.000Z");
    expect(
      resolvePurgeDate({ targetStage: DealStage.POST_LOI, submitted: stale, existing: stale, now: NOW }),
    ).toBeNull();
    expect(
      resolvePurgeDate({ targetStage: DealStage.PRE_LOI, submitted: null, existing: stale, now: NOW }),
    ).toBeNull();
  });

  it("honours a date the consultant typed on a terminal engagement", () => {
    const chosen = new Date("2027-06-30T00:00:00.000Z");
    expect(
      resolvePurgeDate({ targetStage: DealStage.CLOSED, submitted: chosen, existing: null, now: NOW }),
    ).toEqual(chosen);
  });

  it("keeps an existing date rather than resetting it to the default on every save", () => {
    const existing = new Date("2027-01-15T00:00:00.000Z");
    expect(
      resolvePurgeDate({ targetStage: DealStage.CLOSED, submitted: null, existing, now: NOW }),
    ).toEqual(existing);
  });

  it("restores the default if a terminal engagement's date is cleared", () => {
    // Indefinite retention of a dead deal's documents is what spec.md §8 rules out, so a cleared
    // field is not a preference to honour. A consultant needing longer sets a later date.
    expect(
      resolvePurgeDate({ targetStage: DealStage.DEAD, submitted: null, existing: null, now: NOW })?.toISOString(),
    ).toBe(NINETY_DAYS_ON);
  });
});

describe("appendixRetentionSentence", () => {
  it("names the deletion date when one is scheduled", () => {
    // The wording it replaces said the firm "can provide any of them on request", with no end —
    // which a retention run then made false, in a document the buyer still holds.
    const sentence = appendixRetentionSentence(new Date("2026-12-21T12:00:00.000Z"));
    expect(sentence).toContain("2026-12-21");
    expect(sentence).toContain("before then");
    expect(sentence).not.toMatch(/on request\b/);
  });

  it("promises nothing time-bound when no purge is scheduled", () => {
    // A live deal has no date to state, and inventing one would be worse than saying nothing.
    const sentence = appendixRetentionSentence(null);
    expect(sentence).toContain("Ask the firm");
    expect(sentence).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(sentence).not.toContain("scheduled for deletion");
  });

  it("says the documents are not reproduced, in both cases", () => {
    for (const purgeAt of [null, new Date("2027-01-01T00:00:00Z")]) {
      expect(appendixRetentionSentence(purgeAt)).toContain("not reproduced here");
    }
  });
});
