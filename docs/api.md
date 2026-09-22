# CloseCheck read-only API

Reference for the org-scoped read-only API (`docs/spec.md` §13.2). Written for a consultant's own
tooling — a deal tracker, a spreadsheet sync, an internal dashboard.

**This API ships dark.** It is built and tested but unannounced, per `docs/releases.md` §5: the
feature waits for a paying firm to ask for programmatic access rather than being marketed ahead of
evidence. Nothing here is a commitment to a public, versioned contract yet.

## Authentication

Create a key on **Settings**, as an account Owner. The key is shown once at creation and stored
hashed; there is no way to recover it afterwards, only to revoke it and make another.

```
Authorization: Bearer cc_live_<43 characters>
```

Keys are scoped to one Consultant Org and are read-only. There is no write API — see
`spec.md` §13.2 for why that is a decision rather than an omission.

### Failures are deliberately indistinguishable

A missing, malformed, unknown, or revoked key all return the same `401` with the same body. This is
intentional: distinguishing them would tell a caller probing with a stolen or guessed key which of
those it hit.

```json
{ "error": "Missing, unknown, or revoked API key. Pass `Authorization: Bearer cc_live_...`." }
```

### What a key can never do

Isolation is enforced by Postgres row-level security, not by application code. Requesting another
org's engagement, audit, or report by id returns `404` — the same as an id that does not exist
anywhere — because the row is not visible to the query at all. This is verified on every test run
by `tests/integration/api-tenant-isolation.itest.ts`, which drives real cross-org requests against a
running server rather than inspecting the code.

## Rate limits

Budgeted per API key, so one firm's integration cannot spend another's allowance. The default is
120 requests per minute; every successful response carries the current state:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Requests allowed per window |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | Unix seconds when the window resets |

Exceeding the budget returns `429` with a `Retry-After` header in seconds. Pace against
`X-RateLimit-Remaining` rather than discovering the limit by hitting it.

> Operator note: the limiter is in-process and therefore per-instance. With more than one instance
> the effective limit is the configured value times the instance count. See
> `src/lib/api/rateLimit.ts`.

## Endpoints

All responses are JSON. Timestamps are ISO 8601 UTC.

### `GET /api/v1/engagements`

Lists the org's engagements, newest first.

| Query parameter | Default | Notes |
|---|---|---|
| `limit` | 50 | Clamped to 200. A non-numeric value is ignored rather than rejected. |
| `cursor` | — | An engagement id from a previous response's `nextCursor`. |

```json
{
  "engagements": [
    {
      "id": "cmuc…",
      "businessName": "Example Restaurant LLC",
      "primaryDomain": "example-restaurant.com",
      "dealStage": "PRE_LOI",
      "createdAt": "2026-09-22T09:14:02.911Z",
      "updatedAt": "2026-09-22T09:14:02.911Z"
    }
  ],
  "nextCursor": "cmuc…"
}
```

`nextCursor` is `null` on the last page — always present, never omitted, so a client can loop on it
without distinguishing "no more pages" from a field it forgot to handle.

```bash
cursor=""
while :; do
  page=$(curl -s -H "Authorization: Bearer $CC_KEY" \
    "https://<host>/api/v1/engagements?limit=100${cursor:+&cursor=$cursor}")
  echo "$page" | jq -c '.engagements[]'
  cursor=$(echo "$page" | jq -r '.nextCursor // empty')
  [ -z "$cursor" ] && break
done
```

Pagination is cursor-based rather than offset-based on purpose: an engagement created while you are
paginating shifts every offset by one and silently skips a row, whereas a cursor anchored to an id
cannot.

### `GET /api/v1/engagements/{id}`

One engagement with its audits summarized.

```json
{
  "engagement": {
    "id": "cmuc…",
    "businessName": "Example Restaurant LLC",
    "primaryDomain": "example-restaurant.com",
    "dealStage": "PRE_LOI",
    "createdAt": "2026-09-22T09:14:02.911Z",
    "updatedAt": "2026-09-22T09:14:02.911Z",
    "audits": [
      {
        "id": "cmuc…",
        "status": "COMPLETE",
        "createdAt": "2026-09-22T09:20:41.004Z",
        "updatedAt": "2026-09-22T10:02:18.771Z",
        "template": { "slug": "restaurant-online-ordering", "version": 3, "name": "Restaurant with online ordering" }
      }
    ]
  }
}
```

### `GET /api/v1/audits/{id}`

One audit with its findings, in template order.

```json
{
  "audit": {
    "id": "cmuc…",
    "engagementId": "cmuc…",
    "status": "COMPLETE",
    "overallRatingOverride": null,
    "overallRatingOverrideNote": null,
    "createdAt": "2026-09-22T09:20:41.004Z",
    "updatedAt": "2026-09-22T10:02:18.771Z",
    "template": { "slug": "restaurant-online-ordering", "version": 3, "name": "Restaurant with online ordering" },
    "findings": [
      {
        "id": "cmuc…",
        "status": "FAIL",
        "severity": "RED",
        "note": "Domain registered to the owner personally, not the operating entity.",
        "updatedAt": "2026-09-22T09:58:02.115Z",
        "templateItem": { "tier": "A", "method": "AUTOMATED", "title": "Domain registration and ownership" }
      }
    ]
  }
}
```

`template.version` is pinned per audit. An audit started against version 2 keeps reporting version 2
after version 3 is published (`spec.md` §5) — so a finding's meaning is stable, and an integration
comparing audits across time should key on `(slug, version)`, not `slug` alone.

`overallRatingOverride` is the consultant's explicit override of the computed rating, and is
separate from it by design: the computed value is never overwritten. A null override means the
report shows the computed rating.

### `GET /api/v1/reports/{id}`

Report **metadata only**. The rendered PDF is deliberately not served here — it stays behind the
interactive app's authenticated download route, and the client-facing copy behind a revocable portal
link. The API's job is telling your tooling a report exists and what it concluded, not becoming a
second document-distribution channel.

```json
{
  "report": {
    "id": "cmuc…",
    "auditId": "cmuc…",
    "engagementId": "cmuc…",
    "computedOverallSeverity": "RED",
    "overallCoveredCount": 18,
    "overallTotalCount": 23,
    "generatedAt": "2026-09-22T10:04:55.219Z"
  }
}
```

`overallCoveredCount` / `overallTotalCount` are the coverage snapshot taken at generation time —
how much of the checklist had been answered. Items marked not-applicable are excluded from both.

## Enumerated values

| Field | Values |
|---|---|
| `dealStage` | `PRE_LOI`, `POST_LOI`, `CLOSING`, `CLOSED`, `DEAD` |
| `Audit.status` | `IN_PROGRESS`, `COMPLETE` |
| `Finding.status` | `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `NOT_APPLICABLE`, `BLOCKED` |
| `severity` | `GREEN`, `YELLOW`, `RED` |
| `tier` | `A`, `B`, `C` |
| `method` | `AUTOMATED`, `MANUAL` |

Treat these as open sets. A new value is a content change, not a breaking API change, so a client
that switches on them should have a default branch.

## Webhooks

Rather than polling, register an endpoint on **Settings** to receive `audit.completed` and
`report.generated`.

```json
{
  "id": "5f1c…",
  "event": "report.generated",
  "occurredAt": "2026-09-22T10:04:55.219Z",
  "data": {
    "reportId": "cmuc…",
    "auditId": "cmuc…",
    "engagementId": "cmuc…",
    "generatedAt": "2026-09-22T10:04:55.219Z"
  }
}
```

**Payloads carry identifiers and status only — never findings content, never document data**
(`spec.md` §8, §13.3). This is a security boundary, not an oversight: a misconfigured or
compromised endpoint URL must not become an exfiltration path for a seller's diligence material.
Use the id to call back through this API if you want detail. The rule is enforced by an allowlist
test against the real outbound payload, so an event that ever gained a content field would fail the
build rather than ship.

### Verifying a delivery

Each request carries `X-CloseCheck-Signature: sha256=<hex>` — an HMAC-SHA256 of the **raw request
body** using the endpoint's signing secret, shown once when you create the endpoint.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Compute the HMAC over the exact bytes received, before any JSON parse and re-serialize —
round-tripping through a parser can change key order or number formatting and will break the
signature.

Requirements and behaviour:

- **HTTPS only**, and the host must be publicly routable. Private, loopback, link-local and
  carrier-grade-NAT addresses are refused, in every spelling (`src/lib/net/hostSafety.ts`).
- **Delivery is best-effort**: up to 3 attempts with a short backoff, no durable queue
  (`spec.md` §13.3 is explicit that guaranteed delivery is not justified at this stage). Treat
  webhooks as a latency optimization over polling, not as a system of record.
- **Redirects are not followed.** Give the final URL.
- **Deduplicate on the envelope `id`.** A retry after a receiver timeout can deliver the same event
  twice.
- Respond `2xx` promptly. The last delivery outcome per endpoint is shown on Settings.

## Versioning

The path carries `v1`. While the API ships dark there is no deprecation policy to promise; once a
firm is depending on it, breaking changes get a version bump rather than an in-place change.
