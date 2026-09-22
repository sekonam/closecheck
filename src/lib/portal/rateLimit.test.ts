import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimitState } from "@/lib/api/rateLimit";
import { portalRequestAllowed } from "./rateLimit";

const SAVED = { ...process.env };

beforeEach(() => {
  resetRateLimitState();
  process.env.TRUSTED_PROXY_HOPS = "1";
  process.env.PORTAL_RATE_LIMIT_PER_MINUTE_TOKEN = "3";
  process.env.PORTAL_RATE_LIMIT_PER_MINUTE_ADDRESS = "5";
});
afterEach(() => {
  process.env = { ...SAVED };
  resetRateLimitState();
});

function headers(values: Record<string, string> = {}): Headers {
  return new Headers(values);
}

/** One appended hop, as every supported deployment target produces. */
function from(address: string): Headers {
  return headers({ "x-forwarded-for": `10.0.0.1, ${address}` });
}

describe("per-token budget", () => {
  it("allows up to the limit and refuses past it", () => {
    for (let i = 0; i < 3; i++) {
      expect(portalRequestAllowed(from("203.0.113.9"), "tok-a").allowed).toBe(true);
    }
    const refused = portalRequestAllowed(from("203.0.113.9"), "tok-a");
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("does not let one link exhaust another's budget", () => {
    for (let i = 0; i < 6; i++) portalRequestAllowed(from("203.0.113.9"), "tok-a");
    expect(portalRequestAllowed(from("203.0.113.9"), "tok-b").allowed).toBe(true);
  });
});

describe("per-address budget", () => {
  it("refuses a single address hammering many different links", () => {
    // Under the per-token budget alone this is invisible: each link is well inside its own limit.
    process.env.PORTAL_RATE_LIMIT_PER_MINUTE_ADDRESS = "4";
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      if (portalRequestAllowed(from("203.0.113.9"), `tok-${i}`).allowed) allowed++;
    }
    expect(allowed).toBe(4);
  });

  it("leaves a different address unaffected", () => {
    process.env.PORTAL_RATE_LIMIT_PER_MINUTE_ADDRESS = "2";
    for (let i = 0; i < 5; i++) portalRequestAllowed(from("203.0.113.9"), `tok-${i}`);
    expect(portalRequestAllowed(from("198.51.100.4"), "tok-x").allowed).toBe(true);
  });
});

describe("an unknown address must never take the portal offline", () => {
  /**
   * The inversion this design was written against, having made exactly this mistake in sign-in:
   * when no trusted proxy is configured EVERY caller resolves to "unknown", so an address budget
   * that blocks is one host's traffic taking the portal down for every buyer holding a link.
   *
   * The per-token budget still applies, which is what keeps the exemption from being a hole — the
   * exposure stays bounded per link rather than becoming unbounded.
   */
  it("does not block a second viewer when nobody has an address", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    process.env.PORTAL_RATE_LIMIT_PER_MINUTE_ADDRESS = "2";
    for (let i = 0; i < 20; i++) portalRequestAllowed(headers(), `tok-${i}`);
    expect(portalRequestAllowed(headers(), "a-fresh-link").allowed).toBe(true);
  });

  it("still enforces the per-token budget with no address", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    for (let i = 0; i < 3; i++) expect(portalRequestAllowed(headers(), "tok-a").allowed).toBe(true);
    expect(portalRequestAllowed(headers(), "tok-a").allowed).toBe(false);
  });

  it("cannot be re-enabled by forging a forwarded header", () => {
    // At hops=0 the header is ignored outright, so a caller cannot opt themselves into — or out of
    // — an address bucket by supplying one.
    process.env.TRUSTED_PROXY_HOPS = "0";
    process.env.PORTAL_RATE_LIMIT_PER_MINUTE_ADDRESS = "1";
    for (let i = 0; i < 10; i++) {
      expect(portalRequestAllowed(from("203.0.113.9"), `tok-${i}`).allowed).toBe(true);
    }
  });
});

describe("configuration", () => {
  it("falls back to the documented defaults when the env values are garbage", () => {
    process.env.PORTAL_RATE_LIMIT_PER_MINUTE_TOKEN = "plenty";
    // Isolate the token budget: leaving the address budget at its test value would cap this run
    // at 5 and the assertion would be measuring the wrong limiter.
    process.env.PORTAL_RATE_LIMIT_PER_MINUTE_ADDRESS = "10000";
    let allowed = 0;
    for (let i = 0; i < 61; i++) {
      if (portalRequestAllowed(from("203.0.113.9"), "tok-a").allowed) allowed++;
    }
    expect(allowed).toBe(60);
  });
});
