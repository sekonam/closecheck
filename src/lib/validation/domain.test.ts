import { describe, expect, it } from "vitest";
import { normalizeDomain, validatePrimaryDomain } from "./domain";

describe("normalizeDomain", () => {
  it("passes through a bare domain unchanged", () => {
    expect(normalizeDomain("example.com")).toBe("example.com");
  });

  it("strips http(s) protocol", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips path and query string", () => {
    expect(normalizeDomain("https://Example.COM/some/path?query=1")).toBe("example.com");
  });

  it("lowercases", () => {
    expect(normalizeDomain("EXAMPLE.COM")).toBe("example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDomain("  example.com  ")).toBe("example.com");
  });
});

describe("validatePrimaryDomain", () => {
  it("accepts ordinary business domains", () => {
    for (const domain of ["example.com", "example-restaurant.com", "shop.example.co.uk"]) {
      expect(validatePrimaryDomain(domain), domain).toEqual({ ok: true });
    }
  });

  it("accepts an empty value — the field is optional", () => {
    expect(validatePrimaryDomain("")).toEqual({ ok: true });
  });

  it("refuses hosts that would make the Tier A runner reach inside the deployment", () => {
    // The Tier A runner fetches whatever is stored here and writes the response headers, redirect
    // chain, CMS fingerprint and certificate subject back into a Finding the user can read — so an
    // unconstrained value here is a server-side request forgery vector with a read channel.
    for (const host of [
      "169.254.169.254",
      "2852039166",
      "0xA9FEA9FE",
      "127.0.0.1",
      "localhost",
      "10.0.0.5",
      "192.168.1.1",
      "[::1]",
      "metadata.internal",
      "printer.local",
    ]) {
      const verdict = validatePrimaryDomain(normalizeDomain(host));
      expect(verdict.ok, `${host} should be refused`).toBe(false);
    }
  });

  it("refuses a bare IP even when it is public", () => {
    // Every Tier A check reads domain-level records; against an address they are meaningless.
    expect(validatePrimaryDomain("8.8.8.8").ok).toBe(false);
    expect(validatePrimaryDomain("2001:4860:4860::8888").ok).toBe(false);
  });

  it("refuses strings that are not domain names at all", () => {
    expect(validatePrimaryDomain("not a domain").ok).toBe(false);
    expect(validatePrimaryDomain("-leading-hyphen.com").ok).toBe(false);
    expect(validatePrimaryDomain("nodot").ok).toBe(false);
  });
});

describe("normalizeDomain strips what must not reach a URL", () => {
  it("removes credentials and ports", () => {
    expect(normalizeDomain("https://user:pass@example.com:8080/path")).toBe("example.com");
    expect(normalizeDomain("http://example.com:3000")).toBe("example.com");
  });

  it("still refuses a smuggled internal host after normalisation", () => {
    expect(validatePrimaryDomain(normalizeDomain("http://user@169.254.169.254:80/latest/meta-data/")).ok).toBe(false);
  });
});
