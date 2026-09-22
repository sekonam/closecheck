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
