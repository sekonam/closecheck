import { describe, expect, it } from "vitest";

import { isAutomatable, runTierACheck } from "./tierA";

/**
 * The runner registry is looked up by a string, and `in` walks the prototype chain.
 *
 * `RUNNERS` is a plain object literal, so `"constructor" in RUNNERS` is true — and the lookup then
 * returns `Object.prototype.constructor`, which is a function, so the "no runner registered" guard
 * passed it through and called it. `runTierACheck("constructor", "example.com")` returned a String
 * object where a TierAResult belongs, which `runTierAAutomation` would have written onto a Finding
 * as an undefined status and severity.
 *
 * This is the exact footgun `.claude/skills/domain-code-review` already records for Prisma's
 * generated enums — verified empirically there, and here it was live in the product. `automationKey`
 * is product-owned template content rather than anything a consultant supplies, so this needed a
 * template-authoring mistake to fire; the cost of closing it is one lookup.
 */
const INHERITED = ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf"];

describe("runner lookup uses own properties only", () => {
  it("does not treat an inherited Object property as an automated check", () => {
    for (const key of INHERITED) {
      expect(isAutomatable(key), key).toBe(false);
    }
  });

  it("refuses to run one, rather than calling whatever the prototype chain returned", async () => {
    for (const key of INHERITED) {
      await expect(runTierACheck(key, "example.com"), key).rejects.toThrow(/No Tier A runner registered/);
    }
  });

  it("still recognises a real runner", () => {
    // The control: a fix that rejected everything would satisfy both cases above.
    expect(isAutomatable("ssl_cert")).toBe(true);
    expect(isAutomatable("domain_whois")).toBe(true);
  });

  it("still rejects an ordinary unknown key", () => {
    expect(isAutomatable("not_a_real_check")).toBe(false);
    expect(isAutomatable(null)).toBe(false);
    expect(isAutomatable("")).toBe(false);
  });
});
