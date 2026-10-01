import { createHmac, randomUUID } from "node:crypto";
import { withOrgScope } from "@/lib/db/scoped";
import { isPublicHostLiteral } from "@/lib/net/hostSafety";

/**
 * Signed webhook delivery, docs/spec.md §13.3. Deliberately minimal by spec: best-effort with
 * limited retries, no delivery queue, no per-delivery log table — per-endpoint last-outcome columns
 * are the observability surface. Payloads carry identifiers and status only, never findings or
 * document content (spec.md §8): a misconfigured receiver URL must not become an exfiltration path;
 * the receiver calls back through the authenticated read-only API if it wants detail.
 */
export type WebhookEvent =
  | { event: "audit.completed"; data: { auditId: string; engagementId: string; status: string } }
  | {
      event: "report.generated";
      // Deliberately no severity/rating field: the computed overall rating is the report's headline
      // conclusion, which is exactly the class of data the identifier-and-status-only rule exists to
      // keep out of receiver endpoints. The receiver fetches it via GET /api/v1/reports/{id}.
      data: { reportId: string; auditId: string; engagementId: string; generatedAt: string };
    };

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;

/**
 * Endpoint URLs are consultant-owner-supplied and fetched from the server, i.e. an SSRF surface.
 * The payload contains nothing sensitive by design, but refusing obviously-internal targets keeps a
 * hostile URL from using CloseCheck as a probe into wherever it happens to be deployed.
 *
 * The host-safety half now lives in src/lib/net/hostSafety.ts, shared with the Tier A check runner,
 * which has the same problem with a more hostile input. This function keeps only the rules that are
 * genuinely webhook-specific — https, and no embedded credentials — because those belong to the
 * transport, not to whether an address is public. The regex that used to live here missed every
 * alternate spelling of a private address: IPv6 in most of its forms, IPv4-mapped IPv6, and decimal
 * or hex integer literals (2852039166 and 0xA9FEA9FE both name link-local addresses and neither
 * matched). The shared parser handles all of them.
 *
 * Still a guardrail rather than an egress policy: see that module's header on why a name-based
 * check cannot stop DNS rebinding.
 */
export function isDeliverableWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Credentials in the URL would be sent on every delivery and shown back in the settings UI; a
  // webhook endpoint has no use for them.
  if (url.username || url.password) return false;
  return isPublicHostLiteral(url.hostname).safe;
}

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function deliverOnce(url: string, body: string, signature: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "CloseCheck-Webhook/1.0",
      "X-CloseCheck-Signature": signature,
    },
    body,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Receiver responded ${response.status}`);
  }
}

/**
 * Fire-and-forget from the caller's perspective: server actions call this WITHOUT awaiting it (via
 * `void dispatchWebhookEvent(...)`) so a slow or dead receiver never delays the consultant's own
 * request. Safe here because the app runs as a persistent Node server (Docker/Render — see
 * docs/deployment.md), not on a freeze-after-response serverless runtime.
 */
export async function dispatchWebhookEvent(orgId: string, event: WebhookEvent): Promise<void> {
  try {
    const endpoints = await withOrgScope(orgId, (tx) =>
      tx.webhookEndpoint.findMany({ where: { disabledAt: null } }),
    );
    if (endpoints.length === 0) return;

    const body = JSON.stringify({
      id: randomUUID(),
      event: event.event,
      occurredAt: new Date().toISOString(),
      data: event.data,
    });

    await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        // Re-checked at dispatch, not only at create: the stored URL may predate a rule the check
        // has since learned (every alternate private-address spelling it used to miss, for one),
        // and a fetch is the moment the SSRF surface is real. Still name-based — this cannot stop
        // DNS rebinding (hostSafety.ts header) — but a URL the product would refuse to register
        // today must not keep being fetched just because it was registered yesterday.
        if (!isDeliverableWebhookUrl(endpoint.url)) {
          await withOrgScope(orgId, (tx) =>
            tx.webhookEndpoint.update({
              where: { id: endpoint.id },
              data: {
                lastFailureAt: new Date(),
                lastFailureReason: "Refused at dispatch: endpoint URL is not a deliverable public https URL",
              },
            }),
          );
          return;
        }
        const signature = signWebhookPayload(endpoint.secret, body);
        let lastError = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            await deliverOnce(endpoint.url, body, signature);
            await withOrgScope(orgId, (tx) =>
              tx.webhookEndpoint.update({
                where: { id: endpoint.id },
                data: { lastSuccessAt: new Date(), lastFailureAt: null, lastFailureReason: null },
              }),
            );
            return;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
            }
          }
        }
        await withOrgScope(orgId, (tx) =>
          tx.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { lastFailureAt: new Date(), lastFailureReason: lastError.slice(0, 500) },
          }),
        );
      }),
    );
  } catch (err) {
    // Delivery is best-effort by spec — a webhook failure must never surface into the user-facing
    // action that triggered it.
    console.error("Webhook dispatch failed:", err);
  }
}
