import { describe, expect, it } from "vitest";
import { normalizeDomain } from "./domain";

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
