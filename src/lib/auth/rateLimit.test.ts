import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimitState } from "@/lib/api/rateLimit";
import {
  addressAttemptAllowed,
  clearFailedSignIns,
  clientAddressFrom,
  focusedGuessingAllowed,
  recordFailedSignIn,
} from "./rateLimit";

const SAVED = { ...process.env };

beforeEach(() => {
  resetRateLimitState();
  process.env.AUTH_RATE_LIMIT_PER_MINUTE_ADDRESS = "3";
  process.env.AUTH_MAX_FAILED_SIGNINS = "3";
});
afterEach(() => {
  process.env = { ...SAVED };
  resetRateLimitState();
});

describe("per-address budget", () => {
  it("spends on every attempt and refuses once exhausted", () => {
    expect(addressAttemptAllowed("1.2.3.4")).toBe(true);
    expect(addressAttemptAllowed("1.2.3.4")).toBe(true);
    expect(addressAttemptAllowed("1.2.3.4")).toBe(true);
    expect(addressAttemptAllowed("1.2.3.4")).toBe(false);
  });

  it("does not let one address exhaust another's budget", () => {
    for (let i = 0; i < 5; i++) addressAttemptAllowed("1.2.3.4");
    expect(addressAttemptAllowed("5.6.7.8")).toBe(true);
  });
});

describe("focused-guessing budget", () => {
  it("is read-only — merely checking it never spends anything", () => {
    for (let i = 0; i < 20; i++) {
      expect(focusedGuessingAllowed("victim@firm.test", "1.2.3.4")).toBe(true);
    }
  });

  it("refuses once enough failures have been recorded", () => {
    for (let i = 0; i < 3; i++) recordFailedSignIn("victim@firm.test", "1.2.3.4");
    expect(focusedGuessingAllowed("victim@firm.test", "1.2.3.4")).toBe(false);
  });

  /**
   * The property the whole key design exists for. A per-email-only budget is a weapon: anyone who
   * knows an address can burn it with deliberate wrong guesses and lock that person out of their
   * own account. Including the client address in the key means the attacker spends their own
   * budget, and the victim signing in from anywhere else is untouched.
   */
  it("cannot be used to lock a victim out from a different address", () => {
    const victim = "victim@firm.test";
    for (let i = 0; i < 10; i++) recordFailedSignIn(victim, "203.0.113.9"); // the attacker
    expect(focusedGuessingAllowed(victim, "203.0.113.9")).toBe(false);
    expect(focusedGuessingAllowed(victim, "198.51.100.4")).toBe(true); // the victim, elsewhere
  });

  it("tracks different accounts from one address separately", () => {
    for (let i = 0; i < 5; i++) recordFailedSignIn("a@firm.test", "1.2.3.4");
    expect(focusedGuessingAllowed("a@firm.test", "1.2.3.4")).toBe(false);
    expect(focusedGuessingAllowed("b@firm.test", "1.2.3.4")).toBe(true);
  });

  it("forgets a user's failures once they successfully sign in", () => {
    for (let i = 0; i < 3; i++) recordFailedSignIn("user@firm.test", "1.2.3.4");
    expect(focusedGuessingAllowed("user@firm.test", "1.2.3.4")).toBe(false);
    clearFailedSignIns("user@firm.test", "1.2.3.4");
    expect(focusedGuessingAllowed("user@firm.test", "1.2.3.4")).toBe(true);
  });

  it("falls back to the documented default when the env value is garbage", () => {
    process.env.AUTH_MAX_FAILED_SIGNINS = "many";
    for (let i = 0; i < 9; i++) recordFailedSignIn("user@firm.test", "1.2.3.4");
    expect(focusedGuessingAllowed("user@firm.test", "1.2.3.4")).toBe(true);
    recordFailedSignIn("user@firm.test", "1.2.3.4");
    expect(focusedGuessingAllowed("user@firm.test", "1.2.3.4")).toBe(false);
  });
});

describe("clientAddressFrom — X-Forwarded-For is only trusted as far as the proxy count", () => {
  function req(headers: Record<string, string> = {}): Request {
    return new Request("https://example.test/login", { headers });
  }

  /**
   * The regression these exist for. Taking the LEFTMOST X-Forwarded-For entry trusted a value the
   * client sends: every appending proxy (nginx, Cloudflare, Fly, Render) puts the real address
   * after whatever the caller supplied. That made every address-keyed budget bypassable by
   * rotating a header, and — far worse — let an attacker present the VICTIM's address and
   * deliberately exhaust the (email, address) failure budget, which is precisely the lockout weapon
   * the two-key design exists to rule out.
   */
  it("takes the hop the trusted proxy appended, not the one the client supplied", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientAddressFrom(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
  });

  it("cannot be made to report someone else's address by prepending it", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const victimAddress = "198.51.100.4";
    const attacker = clientAddressFrom(
      req({ "x-forwarded-for": `${victimAddress}, 203.0.113.9` }),
    );
    expect(attacker).not.toBe(victimAddress);
    expect(attacker).toBe("203.0.113.9");
  });

  it("counts hops from the right when several proxies are in front", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientAddressFrom(req({ "x-forwarded-for": "1.1.1.1, 9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });

  it("refuses to guess when fewer hops are present than configured", () => {
    // The header did not pass through the expected infrastructure, so nothing in it is trustworthy.
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientAddressFrom(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
  });

  it("ignores the header entirely when nothing is in front of the app", () => {
    // Directly reachable: X-Forwarded-For is wholly attacker-controlled, so every anonymous caller
    // shares one bucket. Over-restricting strangers is the safe direction to be wrong in.
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(clientAddressFrom(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("unknown");
    expect(clientAddressFrom(req({ "x-real-ip": "3.3.3.3" }))).toBe("unknown");
  });

  it("falls back to x-real-ip, which a proxy sets rather than appends", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientAddressFrom(req({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("returns a stable shared bucket name when the address is unknowable", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientAddressFrom(req())).toBe("unknown");
    expect(clientAddressFrom(undefined)).toBe("unknown");
  });
});

describe("the focused-guessing budget survives a flood of API buckets", () => {
  /**
   * Eviction used to run in Map insertion order. Sign-in failure counters live 15 minutes against
   * the API's one, so they were always the oldest entries and therefore the first evicted — a
   * flood of short-lived API buckets flushed exactly the budget meant to survive an attack.
   */
  it("keeps a recorded failure after ten thousand unrelated keys pass through", () => {
    const victim = "victim@firm.test";
    const address = "203.0.113.9";
    for (let i = 0; i < 3; i++) recordFailedSignIn(victim, address);
    expect(focusedGuessingAllowed(victim, address)).toBe(false);

    for (let i = 0; i < 12_000; i++) {
      checkRateLimit(`ip:flood-${i}`, { limit: 120 });
    }

    expect(focusedGuessingAllowed(victim, address)).toBe(false);
  });
});
