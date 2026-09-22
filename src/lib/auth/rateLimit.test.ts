import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimitState } from "@/lib/api/rateLimit";
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

describe("clientAddressFrom", () => {
  function req(headers: Record<string, string> = {}): Request {
    return new Request("https://example.test/login", { headers });
  }

  it("prefers the first hop of x-forwarded-for", () => {
    expect(clientAddressFrom(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip", () => {
    expect(clientAddressFrom(req({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("returns a single shared bucket name when the address is unknowable", () => {
    // Auth.js can invoke authorize without a request in some flows; a stable string keeps the key
    // well-formed rather than producing an "undefined" bucket that silently differs per call site.
    expect(clientAddressFrom(req())).toBe("unknown");
    expect(clientAddressFrom(undefined)).toBe("unknown");
  });
});
