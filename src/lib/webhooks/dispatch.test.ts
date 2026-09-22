import { describe, expect, it } from "vitest";
import { isDeliverableWebhookUrl, signWebhookPayload } from "./dispatch";

describe("isDeliverableWebhookUrl", () => {
  it("accepts public https URLs", () => {
    expect(isDeliverableWebhookUrl("https://hooks.example.com/closecheck")).toBe(true);
  });
  it("rejects non-https", () => {
    expect(isDeliverableWebhookUrl("http://hooks.example.com/x")).toBe(false);
  });
  it("rejects localhost and private-network hosts (SSRF guard, spec §13.3)", () => {
    for (const url of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://192.168.1.10/x",
      "https://169.254.169.254/latest/meta-data",
      "https://172.16.0.1/x",
      "https://api.internal/x",
    ]) {
      expect(isDeliverableWebhookUrl(url), url).toBe(false);
    }
  });
  /**
   * These are the cases the hand-rolled regex this function used to carry did NOT catch. Each one
   * names a private or link-local address in a spelling the browser's URL parser and Node's
   * resolver both accept, so each was a live bypass of the SSRF guard until
   * src/lib/net/hostSafety.ts took over the host check. 169.254.169.254 is cloud instance metadata;
   * reaching it is the whole point of the attack.
   */
  it("rejects private addresses written in a spelling the old regex missed", () => {
    for (const url of [
      "https://2852039166/x", // decimal integer form of 169.254.169.254
      "https://0xA9FEA9FE/x", // hex form of the same
      "https://0251.0376.0251.0376/x", // octal dotted form
      "https://127.1/x", // short form of 127.0.0.1
      "https://[::1]/x", // IPv6 loopback, bracketed
      "https://[::ffff:169.254.169.254]/x", // IPv4-mapped IPv6
      "https://[fd00::1]/x", // IPv6 unique local
      "https://0.0.0.1/x", // 0.0.0.0/8, not just the single literal
      "https://100.64.0.1/x", // carrier-grade NAT
    ]) {
      expect(isDeliverableWebhookUrl(url), url).toBe(false);
    }
  });

  it("rejects a URL carrying credentials", () => {
    // They would be sent on every delivery and echoed back in the settings UI; an endpoint has no
    // use for them, so the safe reading of one being present is that the URL is not what it seems.
    expect(isDeliverableWebhookUrl("https://user:pass@hooks.example.com/x")).toBe(false);
  });

  it("still accepts ordinary public hosts, including IPv6 ones", () => {
    expect(isDeliverableWebhookUrl("https://hooks.example.com:8443/x")).toBe(true);
    expect(isDeliverableWebhookUrl("https://[2606:4700:4700::1111]/x")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isDeliverableWebhookUrl("not a url")).toBe(false);
  });
});

describe("signWebhookPayload", () => {
  it("is a stable sha256 HMAC over the exact body", () => {
    const sig = signWebhookPayload("whsec_test", '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    // Deterministic for the same secret+body, and body-sensitive.
    expect(signWebhookPayload("whsec_test", '{"a":1}')).toBe(sig);
    expect(signWebhookPayload("whsec_test", '{"a":2}')).not.toBe(sig);
    expect(signWebhookPayload("whsec_other", '{"a":1}')).not.toBe(sig);
  });
});
