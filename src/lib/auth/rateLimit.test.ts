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

  /**
   * A short X-Forwarded-For means the request did not traverse the expected infrastructure —
   * someone reached the origin directly, past the CDN. Falling through to x-real-ip there hands the
   * address back to the caller, because nginx only overwrites X-Real-IP when explicitly configured
   * to, so a direct connection can set both headers itself.
   */
  it("does not fall back to x-real-ip when the forwarded chain is too short", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const address = clientAddressFrom(
      req({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "198.51.100.4" }),
    );
    expect(address).toBe("unknown");
  });

  it("does not fall back to x-real-ip when the forwarded header is present but empty", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientAddressFrom(req({ "x-forwarded-for": ",,,", "x-real-ip": "198.51.100.4" }))).toBe("unknown");
    expect(clientAddressFrom(req({ "x-forwarded-for": "   ", "x-real-ip": "198.51.100.4" }))).toBe("unknown");
  });

  it("still honours x-real-ip when no forwarded header is sent at all", () => {
    // A proxy that sets X-Real-IP and not XFF is a real configuration, and there the value is
    // proxy-set rather than appended.
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientAddressFrom(req({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });
});

describe("the per-address budget never becomes a platform-wide lockout", () => {
  /**
   * This budget HARD-REJECTS before the password is checked. If every caller shares one bucket —
   * which is exactly what an unknown address means, and what TRUSTED_PROXY_HOPS=0 guarantees for
   * every request — then thirty requests a minute from one host would make sign-in return null for
   * every user on the deployment. A one-line denial of service against the whole product.
   */
  it("does not apply when the address carries no information", () => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE_ADDRESS = "3";
    for (let i = 0; i < 50; i++) {
      expect(addressAttemptAllowed("unknown")).toBe(true);
    }
  });

  it("still applies normally to a real address", () => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE_ADDRESS = "3";
    expect(addressAttemptAllowed("203.0.113.9")).toBe(true);
    expect(addressAttemptAllowed("203.0.113.9")).toBe(true);
    expect(addressAttemptAllowed("203.0.113.9")).toBe(true);
    expect(addressAttemptAllowed("203.0.113.9")).toBe(false);
  });
});

describe("the two budgets cannot evict each other", () => {
  /**
   * The API limiter and the sign-in limiter used to share one map, which made them adversaries in
   * whichever direction the eviction policy favoured. Insertion order evicted the long-lived
   * sign-in buckets first, so an API flood flushed the budget meant to survive an attack;
   * soonest-expiry eviction inverted it, making sign-in buckets the most privileged entries so a
   * flood of THOSE evicted every tenant's API budget. Both directions are reachable — a failed
   * sign-in mints a bucket keyed on an arbitrary email whether the account exists or not.
   *
   * They are separate stores now, so neither test below can be satisfied by a lucky eviction order.
   * Both floods deliberately exceed MAX_TRACKED_KEYS (10,000), which forces a real prune rather
   * than being throttled away — the previous version of this test flooded 12,000 keys in 6ms, was
   * throttled out of pruning entirely, and passed while evicting nothing.
   */
  it("keeps a recorded sign-in failure through an API flood large enough to force eviction", () => {
    const victim = "victim@firm.test";
    const address = "203.0.113.9";
    for (let i = 0; i < 3; i++) recordFailedSignIn(victim, address);
    expect(focusedGuessingAllowed(victim, address)).toBe(false);

    for (let i = 0; i < 12_000; i++) checkRateLimit(`ip:flood-${i}`, { limit: 120 });

    expect(focusedGuessingAllowed(victim, address)).toBe(false);
  });

  it("keeps a tenant's API budget through a sign-in flood large enough to force eviction", () => {
    const tenantKey = "key:paying-customer";
    checkRateLimit(tenantKey, { limit: 5 });
    checkRateLimit(tenantKey, { limit: 5 });

    // Each of these mints a long-lived bucket on an arbitrary email — free for an attacker, since
    // the account need not exist.
    for (let i = 0; i < 12_000; i++) recordFailedSignIn(`nobody-${i}@nowhere.test`, "203.0.113.9");

    // The tenant has spent 2 of 5; if their bucket had been evicted this would report 4 remaining.
    expect(checkRateLimit(tenantKey, { limit: 5 }).remaining).toBe(2);
  });
});

describe("the failure key is injective", () => {
  /**
   * `${email}:${address}` is not injective when either part can contain a colon — and both can.
   * IPv6 addresses are full of them, and authorize() performs no format validation on the submitted
   * email before it reaches the limiter, so that string is attacker-chosen. Two identities sharing
   * one budget is the same class of defect as a vendor-name normaliser collapsing two companies
   * onto one profile: nothing in the database can catch it, because the key is computed above
   * anything the database can see.
   */
  it("does not let a colon in the email collide with a different email and address", () => {
    // Under raw interpolation both of these produce "login:fail:u@x.test:2001:db8::1".
    recordFailedSignIn("u@x.test:2001", "db8::1");
    recordFailedSignIn("u@x.test:2001", "db8::1");
    recordFailedSignIn("u@x.test:2001", "db8::1");
    expect(focusedGuessingAllowed("u@x.test:2001", "db8::1")).toBe(false);

    // The genuinely different identity must still have its full budget.
    expect(focusedGuessingAllowed("u@x.test", "2001:db8::1")).toBe(true);
  });

  it("keeps IPv6 addresses distinct from one another", () => {
    for (let i = 0; i < 3; i++) recordFailedSignIn("a@b.test", "2001:db8::1");
    expect(focusedGuessingAllowed("a@b.test", "2001:db8::1")).toBe(false);
    expect(focusedGuessingAllowed("a@b.test", "2001:db8::2")).toBe(true);
  });

  it("bounds key size regardless of what was submitted as an email", () => {
    // authorize() does not validate length, so a caller can submit a multi-megabyte string. The
    // limiter caps the NUMBER of tracked keys, not their size.
    const huge = "x".repeat(1_000_000) + "@x.test";
    recordFailedSignIn(huge, "1.2.3.4");
    // Still addressable, and still its own budget rather than colliding with anything.
    expect(focusedGuessingAllowed(huge, "1.2.3.4")).toBe(true);
    expect(focusedGuessingAllowed("x@x.test", "1.2.3.4")).toBe(true);
  });

  it("still clears exactly the key it recorded", () => {
    for (let i = 0; i < 3; i++) recordFailedSignIn("c@d.test", "5.6.7.8");
    expect(focusedGuessingAllowed("c@d.test", "5.6.7.8")).toBe(false);
    clearFailedSignIns("c@d.test", "5.6.7.8");
    expect(focusedGuessingAllowed("c@d.test", "5.6.7.8")).toBe(true);
  });
});

describe("with no trustworthy address, nothing blocks — including the focused budget", () => {
  /**
   * A regression I introduced and then caught by driving it rather than reading it.
   *
   * Exempting only the ADDRESS budget from the unknown-address case fixed a platform-wide denial of
   * service and silently reinstated the victim-lockout weapon: the focused budget is keyed on
   * (email, address) specifically so an attacker's failures spend the attacker's budget, and when
   * every caller resolves to "unknown" that key collapses to per-email. A per-email budget that
   * blocks is exactly what the two-key design exists to prevent.
   *
   * The honest position at TRUSTED_PROXY_HOPS=0 is no sign-in rate limiting at all — blocking on an
   * identity every caller shares is collective punishment — which is why the runbook says not to
   * run that configuration in production.
   */
  it("does not let one caller burn another's budget when nobody has an address", () => {
    process.env.AUTH_MAX_FAILED_SIGNINS = "3";
    for (let i = 0; i < 20; i++) recordFailedSignIn("victim@firm.test", "unknown");
    expect(focusedGuessingAllowed("victim@firm.test", "unknown")).toBe(true);
  });

  it("still cuts off a real address, and still leaves the victim alone", () => {
    process.env.AUTH_MAX_FAILED_SIGNINS = "3";
    const attacker = "203.0.113.9";
    const victim = "198.51.100.4";
    for (let i = 0; i < 5; i++) recordFailedSignIn("victim@firm.test", attacker);
    expect(focusedGuessingAllowed("victim@firm.test", attacker)).toBe(false);
    expect(focusedGuessingAllowed("victim@firm.test", victim)).toBe(true);
  });
});
