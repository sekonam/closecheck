import { describe, expect, it } from "vitest";

import { isPublicHostLiteral, parseIPv4, parseIPv6 } from "./hostSafety";

function reasonFor(host: string): string | null {
  const verdict = isPublicHostLiteral(host);
  return verdict.safe ? null : verdict.reason;
}

describe("parseIPv4", () => {
  it("parses dotted-decimal", () => {
    expect(parseIPv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIPv4("169.254.169.254")).toBe(0xa9fea9fe);
    expect(parseIPv4("8.8.8.8")).toBe(0x08080808);
  });

  it("parses the alternate forms the network stack accepts", () => {
    // A guard that only understands dotted-decimal is bypassed by writing the address differently.
    expect(parseIPv4("2130706433")).toBe(0x7f000001); // decimal
    expect(parseIPv4("0x7f000001")).toBe(0x7f000001); // hex
    expect(parseIPv4("017700000001")).toBe(0x7f000001); // octal
    expect(parseIPv4("127.1")).toBe(0x7f000001); // short form
    expect(parseIPv4("0xA9FEA9FE")).toBe(0xa9fea9fe);
    expect(parseIPv4("2852039166")).toBe(0xa9fea9fe);
  });

  it("rejects things that are not IPv4 literals", () => {
    expect(parseIPv4("example.com")).toBeNull();
    expect(parseIPv4("256.0.0.1")).toBeNull();
    expect(parseIPv4("1.2.3.4.5")).toBeNull();
    expect(parseIPv4("127.0.0.")).toBeNull();
    expect(parseIPv4("")).toBeNull();
    expect(parseIPv4("09.1.1.1")).toBeNull(); // 9 is not a valid octal digit
  });
});

describe("parseIPv6", () => {
  it("expands compressed and full forms", () => {
    expect(Array.from(parseIPv6("::1") ?? [])).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIPv6("2001:4860:4860::8888")?.[0]).toBe(0x20);
    expect(parseIPv6("fe80::1")?.[0]).toBe(0xfe);
  });

  it("expands a trailing dotted-quad", () => {
    const mapped = parseIPv6("::ffff:169.254.169.254");
    expect(mapped?.slice(10, 12)).toEqual(new Uint8Array([0xff, 0xff]));
    expect(mapped?.slice(12)).toEqual(new Uint8Array([169, 254, 169, 254]));
  });

  it("strips brackets and zone indices", () => {
    expect(parseIPv6("[::1]")).not.toBeNull();
    expect(parseIPv6("fe80::1%eth0")?.[0]).toBe(0xfe);
  });

  it("rejects malformed literals", () => {
    expect(parseIPv6("example.com")).toBeNull();
    expect(parseIPv6("::1::2")).toBeNull();
    expect(parseIPv6("gggg::1")).toBeNull();
    expect(parseIPv6("1:2:3")).toBeNull(); // too few groups without ::
  });
});

describe("blocked literal addresses", () => {
  it("blocks the cloud metadata endpoint in every notation", () => {
    // This is the address the SSRF finding named. All five of these reach it.
    expect(reasonFor("169.254.169.254")).toMatch(/link-local/);
    expect(reasonFor("2852039166")).toMatch(/link-local/);
    expect(reasonFor("0xA9FEA9FE")).toMatch(/link-local/);
    expect(reasonFor("0251.0376.0251.0376")).toMatch(/link-local/);
    expect(reasonFor("::ffff:169.254.169.254")).toMatch(/link-local/);
  });

  it("blocks loopback in every notation", () => {
    expect(reasonFor("127.0.0.1")).toMatch(/loopback/);
    expect(reasonFor("127.1")).toMatch(/loopback/);
    expect(reasonFor("2130706433")).toMatch(/loopback/);
    expect(reasonFor("0x7f000001")).toMatch(/loopback/);
    expect(reasonFor("::1")).toMatch(/loopback/);
    expect(reasonFor("localhost")).toMatch(/localhost/);
    expect(reasonFor("api.localhost")).toMatch(/localhost/);
  });

  it("blocks the RFC 1918 private ranges", () => {
    expect(reasonFor("10.0.0.5")).toMatch(/private/);
    expect(reasonFor("172.16.0.1")).toMatch(/private/);
    expect(reasonFor("172.31.255.254")).toMatch(/private/);
    expect(reasonFor("192.168.1.1")).toMatch(/private/);
  });

  it("blocks ranges a dotted-decimal-only guard usually misses", () => {
    expect(reasonFor("0.0.0.0")).toMatch(/this-network/);
    expect(reasonFor("100.64.0.1")).toMatch(/carrier-grade NAT/);
    expect(reasonFor("198.18.0.1")).toMatch(/benchmarking/);
    expect(reasonFor("224.0.0.1")).toMatch(/multicast/);
    expect(reasonFor("255.255.255.255")).toMatch(/reserved/);
    expect(reasonFor("192.0.0.1")).toMatch(/IETF/);
  });

  it("blocks IPv6 internal ranges and the IPv4 they can embed", () => {
    expect(reasonFor("fe80::1")).toMatch(/link-local/);
    expect(reasonFor("fc00::1")).toMatch(/unique local/);
    expect(reasonFor("fd12:3456::1")).toMatch(/unique local/);
    expect(reasonFor("ff02::1")).toMatch(/multicast/);
    expect(reasonFor("::")).toMatch(/unspecified/);
    // 6to4 and NAT64 both carry an IPv4 address inside an IPv6 literal.
    expect(reasonFor("2002:7f00:0001::")).toMatch(/loopback/);
    expect(reasonFor("64:ff9b::a9fe:a9fe")).toMatch(/link-local/);
  });

  it("blocks names that can only resolve inside the deployment", () => {
    expect(reasonFor("intranet")).toMatch(/not a fully-qualified/);
    expect(reasonFor("db")).toMatch(/not a fully-qualified/);
    expect(reasonFor("printer.local")).toMatch(/reserved internal-use/);
    expect(reasonFor("service.internal")).toMatch(/reserved internal-use/);
    expect(reasonFor("")).toMatch(/empty/);
  });
});

describe("allowed hosts", () => {
  it("allows ordinary public hostnames", () => {
    for (const host of ["example.com", "www.example.co.uk", "sub.domain.example.com", "xn--80ak6aa92e.com"]) {
      expect(isPublicHostLiteral(host), host).toEqual({ safe: true });
    }
  });

  it("allows public IP literals", () => {
    expect(isPublicHostLiteral("8.8.8.8")).toEqual({ safe: true });
    expect(isPublicHostLiteral("1.1.1.1")).toEqual({ safe: true });
    expect(isPublicHostLiteral("2001:4860:4860::8888")).toEqual({ safe: true });
  });

  it("is case- and whitespace-insensitive", () => {
    expect(reasonFor("  LOCALHOST  ")).toMatch(/localhost/);
    expect(isPublicHostLiteral("  Example.COM ")).toEqual({ safe: true });
  });

  it("does not block ranges that only look private", () => {
    // 172.32/12 is outside RFC 1918 even though 172.16/12 is inside it — an off-by-one here would
    // silently refuse a real customer domain hosted on one of those addresses.
    expect(isPublicHostLiteral("172.32.0.1")).toEqual({ safe: true });
    expect(isPublicHostLiteral("11.0.0.1")).toEqual({ safe: true });
    expect(isPublicHostLiteral("100.128.0.1")).toEqual({ safe: true });
  });
});
