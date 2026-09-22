import { DealStage } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { DEFAULT_POST_CLOSE_RETENTION_DAYS, TERMINAL_DEAL_STAGES, defaultPurgeDateFor } from "./policy";

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
