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

Last reviewed: 2026-09-24. This document is only true on the date at the top — re-check it against
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
- **Those protections are one decision, not four.** Every route that returns stored bytes — an
  evidence download, the consultant's report PDF, the buyer's portal PDF, the firm's logo — builds
  its headers from a single module that sets `nosniff`, `private` caching and a no-index tag and
  does not let a caller opt out. This followed from finding that the logo route had none of the
  three while the other three had all of them, with nothing to signal the difference: read alone,
  every route's headers looked deliberate. The content-security policy is deliberately *not*
  applied everywhere, because its `sandbox` directive is what would stop a buyer's browser
  rendering the PDF the portal shows them inline.
- **Retention is tied to the engagement lifecycle.** A deal reaching a terminal stage (closed or
  dead) schedules deletion after 90 days by default, which the consultant can move. Reviving a deal
  clears the schedule. A purge job deletes the files and requires the engagement still be terminal.
  A file the job expects and cannot find is treated as an anomaly rather than a success: the row is
  kept, because it is the only remaining pointer to a document that may exist somewhere, and the run
  exits non-zero so the operator sees it.
- **A hole in that model was found and closed on 2026-09-24, and both halves are worth stating.**
  The purge finds documents by joining through database rows, so a document whose row was gone was
  invisible to it permanently. Removing one attachment left its object behind; deleting an
  organisation cascaded every row away in a single statement and left every object those rows named.
  Demonstrated against a live bucket rather than suspected: a document survived deletion of its
  evidence row, its engagement, its audit, and the whole consultant organisation. The case that
  reached it soonest was the one where it mattered most — a consultant who attaches the wrong
  seller's contract, removes it, and is shown that it is gone.

  Removing an attachment now deletes the object as well as the row, in that order, so nothing can
  serve the file in the gap. The cascade path has no code of its own to put a hook in, so it is
  covered instead by a sweep that lists what the backend holds, compares it against every key the
  database names, and reports by default — deleting only when explicitly asked. Its first run here
  found 184 orphans against 18 live keys, which is the backlog the old behaviour had already built
  on one developer machine.

  **Not yet true:** no test removes evidence through the interface a consultant actually uses, so
  the ordering is covered by unit tests rather than end to end. And the sweep is a scheduled cleanup
  rather than a guarantee, so there are two windows in which objects outlive their rows: between a
  cascade delete and the next sweep, and after an object delete that fails once its row has already
  committed. The second is recorded when it happens, naming the sweep as the remedy, so it is
  visible rather than silent — but it is still the sweep that closes it.
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

- **A stored object is served only to the tenant whose prefix it sits under.** Every key begins with
  an owning organisation, and that is now enforced at the operation rather than being a naming
  convention: a tenant-scoped read or write takes the organisation as a required argument and
  refuses a key naming a different one, before any request is issued. Six routes previously read a
  key out of a database row and fetched it — row-level security scoped the *row*, and nothing
  constrained the *key* on it, so a row carrying another firm's key served that firm's document.
  Demonstrated against the running application, then fixed, then held by a test that exercises the
  authenticated download, the report PDF, and the anonymous client portal, plus a legitimate read
  that must still succeed. The retention job is the one deliberate cross-tenant caller and uses a
  separately named operation that says so, mirroring how the database layer names that same script
  as its single documented exception.

**Storage backend, stated precisely, because this was the largest gap in this document and is now
a smaller and differently-shaped one.**

Every read, write and delete goes through a backend interface with two implementations. The
default is the local filesystem, and that is what every deployment runs today. An S3-compatible
backend (AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO — one protocol, so this is
not a commitment to a provider) activates when it is configured; nothing is configured yet, because
choosing one is a decision the firm running this has not made.

- **The S3 backend has been exercised against a live bucket** — Cloudflare R2, on 2026-09-24. This
  sentence previously said it had never stored a real byte and would say so until someone uploaded,
  read and purged a document through it. That happened, through the product's own paths rather than
  a harness: a document attached and downloaded through the audit workflow and then listed in the
  bucket through the provider's API; an object written, read back, byte-compared and deleted by the
  deployment verifier; and the retention purge deleting an object and its row together, leaving the
  bucket empty. What remains untested is everything that needs a deployment — concurrency, scale,
  and behaviour under a provider outage — because no deployment exists yet.
- **On object storage, encryption at rest is the provider's and is not requested per object.** The
  application does not send an encryption header, and does not need to: Cloudflare R2 encrypts every
  object with AES-256-GCM automatically, with no configuration and no documented opt-out, and Amazon
  S3 has applied SSE-S3 (AES-256) to every new upload on every bucket since 5 January 2023. The
  header is in fact *refused* by R2, which lists it as unsupported — so requesting it was both
  unnecessary and, on the provider actually chosen, a guaranteed failure on the first upload. Caught
  before any credential existed, by reading the provider's documentation rather than discovering it
  live.

  What that buys is worth stating precisely, because "encrypted at rest" is the phrase most likely to
  be over-read. It is *provider*-managed: the provider holds the key and can decrypt. It protects
  against theft of a disk and against the disposal of physical media, and protects nothing whatever
  against someone who obtains our credentials. It does not close the application-managed-encryption
  gap in §8, which needs a key-management decision nobody has made. The one improvement over
  requesting it per object is that an unconditional property cannot be forgotten by a future writer.
- **Local disk is no longer a production configuration, and the product refuses to treat it as one.**
  It was one until 2026-09-23, when the deployment blueprint stopped mounting a persistent volume:
  without that mount, an unconfigured production process writes seller contracts to a container
  filesystem that is discarded on the next deploy. A startup warning was the wrong instrument for
  that, because the warning and the data loss are separated by however long it takes someone to
  deploy again. So in production, with no object storage configured and no explicit
  acknowledgement, every read, write and delete refuses — enforced where the backend is resolved,
  not at boot, so it cannot be skipped by a process that starts before anyone looks at the log.

  An operator who genuinely has a mounted volume can still say so, deliberately, and is then told
  once what it costs: encryption at rest is whatever the volume provides rather than
  application-managed, and there is no redundancy, because the volume is a single copy. What is no
  longer possible is arriving in that state without having chosen it.

The containment guard above is what made replacing the writer safe to do rather than a re-audit —
the refusal lives with the operation, so neither backend trusts a key it was handed. Each enforces
what it can actually reason about: local refuses a key resolving outside the storage root, S3
refuses one that is not a plain relative object name, because a key with `..` or a leading slash
still lands somewhere on S3 — just outside the per-tenant prefix that makes separation legible.

---

## 5. Credentials and secrets

- **No third-party credentials are accepted, stored, or proxied.** This is a product decision
  (`spec.md` §4), not an unimplemented feature: Tier C live-access checks are performed by the
  consultant in their own browser and recorded as an attestation. There is no code path anywhere
  that takes a seller's hosting, point-of-sale or booking login.
- Account passwords are bcrypt-hashed. API keys are shown once and stored as SHA-256 digests — a
  random 32-byte token has no dictionary to attack, and the digest doubles as the lookup column.
- **Webhook signing secrets are the exception, and are stored in plaintext.** They cannot be
  digested: the secret is the HMAC key used to sign every outgoing payload, so the product must be
  able to recover it to produce a signature the receiving system can verify. That is inherent to
  signed webhooks rather than a shortcut, but it is a real difference in exposure and is stated
  here rather than left to be inferred from the word "secrets": anyone who can read the database
  can sign payloads that a firm's own integration will accept as genuine. The mitigations are that
  the value is generated randomly, shown once, never logged, and revocable per endpoint from
  settings — and that this is one more reason the database roles are narrow and none of them is a
  superuser (§3).
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
- **Sharing and withdrawal are attributed to a seat.** A portal link records which of the firm's
  people sent the report outside, and which withdrew it — the two engagement-scoped actions with
  effects outside the firm. Re-withdrawing an already-dead link changes nothing: the first
  revocation is the event.
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
- **No application-managed encryption at rest for uploaded documents** (§4 above). Provider-managed
  server-side encryption is enabled on the S3 backend, which is not the same control.
- **No production deployment running object storage.** The S3 backend exists and is unexercised.
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
absence of any external assessment, the process-and-paperwork layer that has not been written
because nobody has asked for it yet, and a storage substrate that is now a configuration decision
rather than missing code — the S3 backend is written and has never been pointed at a bucket.

If any of the §8 items is a blocker for you, say which one. That is exactly the evidence `spec.md`
§8 gates this work on, and it is more useful than a guess about what buyers want.
