import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  rateLimitKeyForRequest,
  resetRateLimitState,
  rateLimitHeaders,
} from "./rateLimit";

const SAVED = { ...process.env };

beforeEach(() => {
  resetRateLimitState();
  process.env.API_RATE_LIMIT_PER_MINUTE = "3";
});
afterEach(() => {
  process.env = { ...SAVED };
  resetRateLimitState();
});

describe("checkRateLimit", () => {
  it("allows up to the limit and refuses past it", () => {
    expect(checkRateLimit("k").allowed).toBe(true);
    expect(checkRateLimit("k").allowed).toBe(true);
    expect(checkRateLimit("k").allowed).toBe(true);
    expect(checkRateLimit("k").allowed).toBe(false);
  });

  it("counts each key independently, so one tenant cannot spend another's budget", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("noisy");
    expect(checkRateLimit("noisy").allowed).toBe(false);
    expect(checkRateLimit("quiet").allowed).toBe(true);
  });

  it("reports a remaining count that reaches zero and does not go negative", () => {
    expect(checkRateLimit("k").remaining).toBe(2);
    expect(checkRateLimit("k").remaining).toBe(1);
    expect(checkRateLimit("k").remaining).toBe(0);
    expect(checkRateLimit("k").remaining).toBe(0);
  });

  it("starts a fresh window once the old one has passed", () => {
    const start = 1_000_000;
    for (let i = 0; i < 4; i++) checkRateLimit("k", start);
    expect(checkRateLimit("k", start).allowed).toBe(false);
    // One millisecond past the window boundary the budget is new again.
    expect(checkRateLimit("k", start + 60_001).allowed).toBe(true);
  });

  it("always reports a retry-after of at least one second", () => {
    const start = 1_000_000;
    for (let i = 0; i < 4; i++) checkRateLimit("k", start);
    // Sampled at the very last millisecond of the window, a naive ceil could produce 0 and invite
    // an immediate retry that is still refused.
    const result = checkRateLimit("k", start + 59_999);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the documented default when the env value is garbage", () => {
    process.env.API_RATE_LIMIT_PER_MINUTE = "lots";
    expect(checkRateLimit("k").limit).toBe(120);
    process.env.API_RATE_LIMIT_PER_MINUTE = "0";
    resetRateLimitState();
    expect(checkRateLimit("k2").limit).toBe(120);
  });
});

describe("rateLimitKeyForRequest", () => {
  function req(headers: Record<string, string> = {}): Request {
    return new Request("https://example.test/api/v1/engagements", { headers });
  }

  it("budgets an authenticated request against its API key, not its address", () => {
    const key = rateLimitKeyForRequest(req({ "x-forwarded-for": "9.9.9.9" }), "apikey_1");
    expect(key).toBe("key:apikey_1");
  });

  it("uses the first hop of x-forwarded-for for anonymous requests", () => {
    expect(rateLimitKeyForRequest(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("ip:1.1.1.1");
  });

  it("falls back to x-real-ip, then to a single shared anonymous bucket", () => {
    expect(rateLimitKeyForRequest(req({ "x-real-ip": "3.3.3.3" }))).toBe("ip:3.3.3.3");
    // Degrading to one global budget for unidentifiable anonymous traffic is the safe direction:
    // it over-restricts strangers rather than under-restricting them.
    expect(rateLimitKeyForRequest(req())).toBe("ip:unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("reports the reset time in seconds, as HTTP consumers expect", () => {
    const result = checkRateLimit("k", 1_000_000);
    const headers = rateLimitHeaders(result);
    expect(headers["X-RateLimit-Limit"]).toBe("3");
    expect(Number(headers["X-RateLimit-Reset"])).toBe(Math.ceil((1_000_000 + 60_000) / 1000));
  });
});
