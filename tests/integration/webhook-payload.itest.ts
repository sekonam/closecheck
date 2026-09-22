import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import {
  createOrgFixture,
  createWebhookEndpoint,
  destroyOrgFixture,
  SECRET_FINDING_NOTE,
  SECRET_STRUCTURED_VALUE,
  type OrgFixture,
} from "./helpers/fixtures";

/**
 * docs/releases.md §5 launch gate, Phase 4 depth set:
 *
 *   "Webhook payloads confirmed to carry identifiers and status only — no findings content, no
 *    document data (spec.md §13.3) — checked against the real serialized payload, not the intent."
 *
 * "The real serialized payload" is the load-bearing phrase, so this test does not inspect the
 * WebhookEvent type or call a formatting helper. It runs the actual dispatcher against an actual
 * endpoint row, intercepts the outbound request at `fetch`, and asserts on the exact bytes that
 * would have gone over the wire. The org fixture plants sentinel strings in the audit's finding note
 * and structuredData specifically so a leak has something recognizable to be caught by.
 *
 * isDeliverableWebhookUrl() blocks localhost, so the endpoint is registered with an unroutable
 * https host and the request is captured before it leaves the process — which is also why this
 * needs no listening receiver.
 */
describe("Phase 4 launch gate — webhook payloads carry identifiers and status only", () => {
  let org: OrgFixture;
  let endpointSecret: string;
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];

  beforeAll(async () => {
    org = await createOrgFixture("hook");
    const endpoint = await createWebhookEndpoint(org.orgId, "https://receiver.invalid/closecheck");
    endpointSecret = endpoint.secret;

    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sent.push({
        url: String(input),
        body: String(init?.body ?? ""),
        headers: Object.fromEntries(headers.entries()),
      });
      return new Response("", { status: 200 });
    });

    await dispatchWebhookEvent(org.orgId, {
      event: "audit.completed",
      data: { auditId: org.auditId, engagementId: org.engagementId, status: "COMPLETE" },
    });
    await dispatchWebhookEvent(org.orgId, {
      event: "report.generated",
      data: {
        reportId: org.reportId,
        auditId: org.auditId,
        engagementId: org.engagementId,
        generatedAt: new Date().toISOString(),
      },
    });

    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (org) await destroyOrgFixture(org.orgId);
  });

  it("actually dispatched both events to the registered endpoint", () => {
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.url).toBe("https://receiver.invalid/closecheck");
    }
  });

  it("never includes finding content in any payload", () => {
    for (const request of sent) {
      expect(request.body).not.toContain(SECRET_FINDING_NOTE);
      expect(request.body).not.toContain(SECRET_STRUCTURED_VALUE);
    }
  });

  it("never includes the target business name or the consultant firm name", () => {
    for (const request of sent) {
      expect(request.body).not.toContain(org.orgName);
      expect(request.body.toLowerCase()).not.toContain("diner");
    }
  });

  /**
   * Scans parsed keys and values rather than the raw body: a raw substring search produces false
   * positives (the envelope's own "occurredAt" contains "red"), and the thing actually being
   * asserted is that no *field* carries a rating, not that six letter sequences are absent.
   */
  it("never includes a severity or overall rating in any key or value", () => {
    const forbiddenWords = ["severity", "rating", "red", "yellow", "green", "finding", "note"];
    for (const request of sent) {
      const payload = JSON.parse(request.body);
      const walk = (node: unknown, path: string): void => {
        if (typeof node === "string") {
          const lowered = node.toLowerCase();
          for (const word of forbiddenWords) {
            expect(lowered, `${path} carried "${word}"`).not.toBe(word);
          }
          return;
        }
        if (node && typeof node === "object") {
          for (const [key, value] of Object.entries(node)) {
            for (const word of forbiddenWords) {
              expect(key.toLowerCase(), `key at ${path}.${key} looks like ${word}`).not.toContain(word);
            }
            walk(value, `${path}.${key}`);
          }
        }
      };
      walk(payload.data, "data");
    }
  });

  /**
   * An allowlist, not a denylist: a future event that adds a field nobody thought to forbid fails
   * here rather than silently shipping. Extending this list is the deliberate act of re-affirming
   * that the new field is an identifier or a status.
   */
  it("carries only allowlisted keys at every level of the payload", () => {
    const allowedEnvelope = new Set(["id", "event", "occurredAt", "data"]);
    const allowedData = new Set([
      "auditId",
      "engagementId",
      "reportId",
      "status",
      "generatedAt",
    ]);

    for (const request of sent) {
      const payload = JSON.parse(request.body);
      for (const key of Object.keys(payload)) {
        expect(allowedEnvelope.has(key), `unexpected envelope key "${key}"`).toBe(true);
      }
      for (const key of Object.keys(payload.data)) {
        expect(allowedData.has(key), `unexpected data key "${key}"`).toBe(true);
      }
      // Identifiers and statuses are scalars; a nested object or array is how structured content
      // would arrive, so the shape itself is an assertion.
      for (const value of Object.values(payload.data)) {
        expect(typeof value).toBe("string");
      }
    }
  });

  it("only ever contains values the receiver already had or can act on as an opaque id", () => {
    const knownIds = new Set([org.auditId, org.engagementId, org.reportId]);
    for (const request of sent) {
      const payload = JSON.parse(request.body);
      for (const [key, value] of Object.entries(payload.data as Record<string, string>)) {
        if (key.endsWith("Id")) {
          expect(knownIds.has(value), `${key} was not one of the fixture's ids`).toBe(true);
        }
      }
      expect(["audit.completed", "report.generated"]).toContain(payload.event);
    }
  });

  it("signs each delivery with the endpoint's own secret over the exact body sent", () => {
    for (const request of sent) {
      const header = request.headers["x-closecheck-signature"];
      expect(header, "no X-CloseCheck-Signature header").toBeTruthy();
      const expected = `sha256=${createHmac("sha256", endpointSecret).update(request.body).digest("hex")}`;
      expect(header).toBe(expected);
    }
  });

  it("gives each delivery a distinct envelope id for receiver-side deduplication", () => {
    const ids = sent.map((r) => JSON.parse(r.body).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not deliver to another org's endpoint", async () => {
    const other = await createOrgFixture("hook-other");
    try {
      const before = sent.length;
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(input), body: String(init?.body ?? ""), headers: {} });
        return new Response("", { status: 200 });
      });
      // `other` has no endpoint registered; org's endpoint must not receive other's event.
      await dispatchWebhookEvent(other.orgId, {
        event: "audit.completed",
        data: { auditId: other.auditId, engagementId: other.engagementId, status: "COMPLETE" },
      });
      vi.unstubAllGlobals();
      expect(sent.length).toBe(before);
    } finally {
      await destroyOrgFixture(other.orgId);
    }
  });
});
