# CloseCheck — Security posture

**What this is.** An honest inventory of the controls this product actually has, written to answer
a consultant's — or their client's — security questions without anyone having to read the source.

**What this is not.** A claim of certification, a compliance attestation, or a marketing document.
`spec.md` §8 and §13.4 hold a standing decision that SOC 2 work is gated on a real sales blocker
(a firm's client contract or a partner integration making it one) rather than pursued
speculatively. That decision is unchanged. This document exists because the *inventory* is useful
long before the certification is — it is what gets sent when a firm asks, and writing it forces the
gaps into the open.

**Every "not yet" below is deliberate and stated.** A posture document that lists only strengths is
worse than none: the first reader who finds an omission stops believing the rest of it.

Last reviewed: 2026-09-22. This document is only true on the date at the top — re-check it against
the code before sending it to anyone.

---

## 1. The risk this product is actually managing

`spec.md` §8 states the framing everything below follows from: **the core risk is reputational, not
competitive.** A leak of one seller's business data — contracts, merchant statements, a consultant's
reading of them — during diligence on a deal that may never close would be catastrophic for every
consultant using the product, not only the one affected.

That is why tenant isolation is treated as the one thing that cannot ship broken, and why the
controls below are weighted the way they are.

---

## 2. Tenant isolation

Enforced at **two independent layers**, deliberately redundant, so a bug in either alone cannot
leak across tenants.

**Application layer.** Every tenant-scoped query runs through a single helper (`withOrgScope`) that
sets the acting organisation for the transaction. There is no escape hatch: an earlier
`unscoped()` helper was removed rather than left available.

**Database layer.** Every tenant-owned table carries the owning organisation and a PostgreSQL
row-level-security policy keyed to the session's organisation. Policies are `ENABLE`d **and**
`FORCE`d — without `FORCE`, a table's owner bypasses its own policy, and the migration role is the
owner.

As of the review date, RLS is enabled and forced on: consultant orgs, users, engagements, audits,
findings, evidence, reports, client portal links, portal access log, API keys, webhook endpoints,
email messages, billing accounts, the audit credit ledger, and vendor term profiles.

**Three tables deliberately have no RLS**, and the reasons differ:

- `templates` and `template_items` are product-owned content shared by every consultant. They are
  not tenant data, and the runtime role holds `SELECT` only — a consultant cannot alter checklist
  content, which is also what makes template versioning meaningful.
- `metric_events` and `error_events` are founder telemetry. Rather than relying on a policy, the
  runtime role's `SELECT` is revoked outright and rows are inserted without reading anything back.
  There is no org-scoped read path to this data by design.

**Verification, not assertion.** Isolation is checked by scripts that create two organisations and
attempt cross-tenant reads and writes, including deliberately *unfiltered* reads that would expose
a policy silently degrading to "visible to everyone" — a filtered query still looks correct when
that happens. The client portal access log gets particular attention because it carries the only
subquery-based policy in the schema (an anonymous buyer has no session to scope by).

---

## 3. Database access is least-privilege, not one superuser

Five narrow roles, each used by exactly one module, none of them superusers and none holding
`BYPASSRLS`:

| Role | What it may do |
|---|---|
| `closecheck_app` | The runtime role for the interactive application. |
| `closecheck_auth` | Sign-in lookup only — reads a user by unique email, never lists across orgs. |
| `closecheck_signup` | Self-serve account creation only. |
| `closecheck_portal` | The anonymous buyer path: reads one report through one live token, and appends to the access log. It holds no `SELECT` on the log it writes to. |
| `closecheck_api` | The read-only API, with column-level restrictions so a key cannot rewrite its own organisation. |

The migration/superuser role is used only for migrations and administrative scripts, never at
runtime. RLS is silently bypassed for a superuser, which is exactly why this separation exists.

---

## 4. Documents and evidence

Uploaded Tier B documents — executed contracts, merchant statements — are the most sensitive data
this product holds.

- **Validated on the way in.** Size limit, an allowlist of the formats diligence documents actually
  arrive as, and a content check: the file's own leading bytes must match the type it claims to be,
  because the declared type is an assertion by the uploader rather than a fact. SVG, HTML and
  archives are refused by name.
- **Served defensively.** Always as `application/octet-stream` with an attachment disposition,
  `X-Content-Type-Options: nosniff`, a `default-src 'none'` content-security policy, and
  `Cache-Control: private, no-store`. A seller's document is content this product neither authored
  nor can vouch for; it is never rendered inline in the application's own origin.
- **Retention is tied to the engagement lifecycle.** A deal reaching a terminal stage (closed or
  dead) schedules deletion after 90 days by default, which the consultant can move. Reviving a deal
  clears the schedule. A purge job deletes the files and requires the engagement still be terminal.
- **Provenance is recorded**: what a document is, how large, and which named person attached it.
- **Storage keys are contained at the operation, not at the generator.** Every read, write and
  delete resolves the key and refuses anything landing outside the storage root — absolute paths and
  `..` traversal included. This matters because the key generators are not the only source of keys:
  a `storageKey` read back from the database is a bare string, and before this guard a row carrying
  a traversing key made the retention job delete a file outside the root while reporting a clean
  run, and the authenticated download route returned its contents. Demonstrated, then fixed; it was
  not reachable through the application, because the upload path sanitises filenames and browsers
  strip paths. Recorded here rather than omitted as "latent" because the consumer of these
  operations is a scheduled job that deletes.

**Not yet true, and material:** object storage is still a local-filesystem stand-in. Encryption at
rest is therefore whatever the underlying volume provides, not application-managed, and the module
is marked in-source as not for production. This is the largest single gap in this document.

The containment guard above narrows what a swap has to re-examine; it does not narrow this gap.
Encryption at rest is a property of the substrate and is simply absent. What the guard buys is that
replacing the writer — which is what moving to S3-compatible storage does — cannot silently reopen
traversal, because the refusal lives with the operation rather than with the code that happened to
build the key.

---

## 5. Credentials and secrets

- **No third-party credentials are accepted, stored, or proxied.** This is a product decision
  (`spec.md` §4), not an unimplemented feature: Tier C live-access checks are performed by the
  consultant in their own browser and recorded as an attestation. There is no code path anywhere
  that takes a seller's hosting, point-of-sale or booking login.
- Account passwords are bcrypt-hashed. API keys and webhook secrets are shown once and stored as
  SHA-256 digests — a random 32-byte token has no dictionary to attack, and the digest doubles as
  the lookup column.
- One-time secrets (a new API key, a webhook signing secret, an invited teammate's temporary
  password) are handed over in a cookie scoped to the settings page, `httpOnly`, `Secure` in
  production, expiring in 60 seconds.
- Sign-in budgets failed attempts per email and per client address, and pays the same bcrypt cost on
  the unknown-account path so response time does not reveal whether an address has an account.

---

## 6. Outbound requests

Two paths make requests to hosts a user supplied: the Tier A automated checks, and webhook
delivery. Both go through a host guard that parses addresses rather than pattern-matching text —
decimal, hexadecimal and octal IPv4 forms, and IPv4 embedded in IPv6 — and refuses private,
loopback, link-local, carrier-grade-NAT and reserved ranges.

For the Tier A checks the guard runs on **every redirect hop**, not only the initial host, and the
domain is resolved and re-checked immediately before connecting. That matters here specifically
because those responses are written into the finding the consultant reads back.

**Stated limitation:** this is not a DNS-rebinding defence and not an egress policy. A record whose
time-to-live expires between the check and the connection still wins. Closing that properly needs
address pinning or a network-level control, and neither exists yet.

---

## 7. What is logged, and what a consultant can see

- **Client portal access**: every view of a shared report, with a SHA-256 hash of the viewer's
  network address rather than the address. Surfaced to the consultant as a per-link trail. Repeat
  visits from one origin can be told from separate viewers; nobody is identified, and the interface
  says so rather than letting the number be over-read.
- **Report exports** by the consultant are recorded.
- Operational metrics and errors are recorded for the operator with no org-scoped read path.

**Not yet true:** there is no general administrative audit log of consultant actions within an
organisation, and no alerting on anomalous access.

---

## 8. What this product does not have

Stated plainly, because the omissions are what a reader is really checking for.

- **No SOC 2, ISO 27001, or any third-party audit or certification.** None is in progress. See
  `spec.md` §8 and §13.4 for why this is a deliberate gate rather than an oversight.
- **No independent penetration test.** Security review to date has been internal, including
  adversarial passes that execute the code rather than read it — which has found real defects,
  including two in guards that had already been reviewed and believed correct.
- **No application-managed encryption at rest for uploaded documents** (§4 above).
- **No formal incident-response plan, breach-notification process, or named security contact.**
- **No business-continuity or disaster-recovery testing** beyond a backup drill script.
- **No data-processing agreement, sub-processor list, or privacy policy** as published documents.
- **No customer-managed keys, no data-residency options, no single sign-on.**
- **No bug-bounty or coordinated-disclosure process.**

Several of these are cheap and would be worth doing the moment a real customer asks — a named
security contact and a disclosure process most of all, since they cost almost nothing and their
absence is what makes a reader doubt everything above.

---

## 9. If you are evaluating this

The honest summary: the isolation and least-privilege work is genuinely thorough and independently
verified, the credential decision removes the largest category of risk by design rather than by
control, and the document-handling path is validated and defensively served. The gaps are the
production storage substrate, the absence of any external assessment, and the process-and-paperwork
layer that has not been written because nobody has asked for it yet.

If any of the §8 items is a blocker for you, say which one. That is exactly the evidence `spec.md`
§8 gates this work on, and it is more useful than a guess about what buyers want.
