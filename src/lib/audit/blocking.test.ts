import { BlockingDependency, DealStage } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isLikelyUnavailable, unavailableReason } from "./blocking";

describe("isLikelyUnavailable", () => {
  it("never blocks an item with no dependency", () => {
    // Tier A is the pre-LOI surface — a consultant can run it on a prospect before being engaged.
    for (const stage of Object.values(DealStage)) {
      expect(isLikelyUnavailable(BlockingDependency.NONE, stage), stage).toBe(false);
    }
  });

  it("flags document-dependent items before diligence formally starts", () => {
    expect(isLikelyUnavailable(BlockingDependency.SELLER_DOCUMENTS, DealStage.PRE_LOI)).toBe(true);
    expect(isLikelyUnavailable(BlockingDependency.SELLER_DOCUMENTS, DealStage.POST_LOI)).toBe(false);
    expect(isLikelyUnavailable(BlockingDependency.SELLER_DOCUMENTS, DealStage.CLOSING)).toBe(false);
  });

  it("flags live-access items until late in the process", () => {
    expect(isLikelyUnavailable(BlockingDependency.LIVE_ACCESS, DealStage.PRE_LOI)).toBe(true);
    expect(isLikelyUnavailable(BlockingDependency.LIVE_ACCESS, DealStage.POST_LOI)).toBe(true);
    expect(isLikelyUnavailable(BlockingDependency.LIVE_ACCESS, DealStage.CLOSING)).toBe(false);
  });

  it("stops flagging once the deal has ended either way", () => {
    // A closed deal's audit is being written up and a dead deal's is being filed. Marking every
    // item "not yet available" on an engagement that already ended would be nonsense.
    for (const dependency of Object.values(BlockingDependency)) {
      expect(isLikelyUnavailable(dependency, DealStage.CLOSED), dependency).toBe(false);
      expect(isLikelyUnavailable(dependency, DealStage.DEAD), dependency).toBe(false);
    }
  });
});

describe("unavailableReason", () => {
  it("explains what is missing, and says Blocked is the right status", () => {
    const reason = unavailableReason(BlockingDependency.SELLER_DOCUMENTS, DealStage.PRE_LOI);
    expect(reason).toMatch(/seller or broker/);
    expect(reason).toMatch(/Blocked/);
  });

  it("returns null when the item is available", () => {
    expect(unavailableReason(BlockingDependency.SELLER_DOCUMENTS, DealStage.CLOSING)).toBeNull();
    expect(unavailableReason(BlockingDependency.NONE, DealStage.PRE_LOI)).toBeNull();
  });
});
