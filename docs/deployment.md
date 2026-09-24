# Deployment

Operational runbook for getting CloseCheck running on real infrastructure. Not a spec/roadmap
document — see `docs/spec.md` §10 and §8 for the security/architecture decisions this implements
against.

## Why Render (or similar), not Vercel

Two things about this app don't fit a stateless serverless platform:

- **PDF report generation** (`src/lib/reports/pdf.ts`) launches a real headless Chromium via
  Playwright. That needs a full Chromium binary installed in the runtime image and a process that
  can actually launch it — awkward-to-impossible within typical serverless function size/runtime
  constraints.
- **Evidence/logo/report storage** goes to Cloudflare R2 through the S3-compatible backend
  (`src/lib/storage/objectStore.ts`, "Object storage" below). The local-disk backend still exists
  for development and for an operator who deliberately mounts a volume, but the app **refuses** to
  use it in production unless `STORAGE_ACKNOWLEDGE_LOCAL=true` is set — an unmounted container
  filesystem loses every document on the next deploy, and a warning in a boot log was the silent
  path to that.

Render, Fly.io, Railway, or a plain VPS all work — anything that runs a long-lived container. This
runbook assumes Render specifically (`render.yaml` at repo root is a Render Blueprint), since it
bundles Docker + managed Postgres in one place with infrastructure-as-code support. No persistent
disk is attached: with R2 it would be billed and never written to, and a service with a disk cannot
take Render's zero-downtime deploys.

## What this runbook cannot do for you

Creating the hosting account and entering billing details has to happen in your own browser — that's
not something that should be automated on your behalf regardless of who's doing the deploying.
Everything up to that point (Dockerfile, migrations, config) is ready to go; the account creation and
first "Apply Blueprint" click are yours.

## First deploy

1. **Create the Render account and connect this repo** (render.com → New → Blueprint → point at this
   repo). Render reads `render.yaml` and proposes the `closecheck` web service + `closecheck-db`
   Postgres instance.
2. **Before applying**, note Render's plan pricing for the `starter` web service plan and
   `basic-256mb` Postgres plan (check current pricing at render.com/pricing — this repo doesn't hold
   a live price). Neither has a permanent free tier.
3. **Apply the blueprint.** The web service's first deploy will fail health checks or crash on any
   DB-touching request — that's expected, because steps 4–6 haven't run yet.
4. **Set `DIRECT_DATABASE_URL`** on the web service to the new database's *Internal Connection
   String* (Render dashboard → closecheck-db → Connect). This is the only DB env var that can be set
   before the app roles exist.
5. **Trigger a deploy** (or let the blueprint's `preDeployCommand` run on its own) so
   `npm run db:migrate:deploy` runs and creates the `closecheck_app` / `closecheck_auth` /
   `closecheck_signup` / `closecheck_portal` / `closecheck_api` roles — still on their hardcoded dev passwords at this
   point (see those migrations' docstrings).
6. **Rotate the role passwords immediately.** From your own machine, with `DIRECT_DATABASE_URL` set
   to the database's *External Connection String* (you're connecting from outside Render's private
   network here):
   ```
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/rotate-production-role-passwords.ts
   ```
   This prints `DATABASE_URL`, `AUTH_DATABASE_URL`, `SIGNUP_DATABASE_URL`, `PORTAL_DATABASE_URL`,
   and `API_DATABASE_URL` once, to your terminal only. Copy each into the matching env var on the Render web service, then
   clear your terminal scrollback.
7. **Set `TRUSTED_PROXY_HOPS` to the number of reverse proxies in front of the service.** One for
   Render, Fly, or a single nginx — which is the default, and is already pinned explicitly in
   `render.yaml`. Set it to `0` only if the app is reachable directly with nothing in front.

   This is small and load-bearing. Every rate limit — the read-only API's, and both of sign-in's —
   keys on the client address, read from `X-Forwarded-For` counting this many hops from the right.
   Set too low, and the value a caller supplies in that header is trusted: they can evade their own
   budget, and can present someone else's address to burn that person's sign-in budget and lock
   them out of their own account. That was a real vulnerability here (fixed 2026-09-22), and the fix
   depends entirely on this number matching the deployment.

   Set too high — or set to `0` when a proxy *is* present — and every caller collapses into one
   shared bucket. Worth being blunt about what that does, because the two limiters fail in opposite
   directions from the same mistake and only one of them is benign:

   - For the **API** limiter, a shared bucket is an inconvenience. Anonymous callers exhaust one
     budget and get 429s; authenticated callers are keyed on their API key and are unaffected.
   - For **sign-in**, it is an outage. That budget hard-rejects *before the password is checked*, so
     one host sending 30 requests a minute would make sign-in fail for every user on the
     deployment. The code special-cases an unknown address for exactly this reason and skips the
     address budget entirely rather than sharing one — but that means anti-spray protection is
     genuinely absent in that configuration, not merely degraded.

   "It degrades safely" was true of one limiter and catastrophic for the other. Set the number.

   **`0` means no sign-in rate limiting whatsoever — do not run it in production.** Both sign-in
   budgets are exempt when the address is unknown, and that is deliberate rather than an oversight:
   the focused budget is keyed on (email, address) specifically so an attacker's failed guesses
   spend the attacker's budget instead of the victim's, and when every caller resolves to the same
   unknown address that key collapses to per-email — at which point blocking on it locks the victim
   out of their own account. With no trustworthy client identity the choice is between locking out
   real users and not limiting, and not limiting is the lesser harm. Failures are still recorded, so
   grinding remains visible in `npm run ops:errors` even where it cannot be blocked.

8. **Set `NEXTAUTH_URL`** to the `*.onrender.com` URL Render assigned the service (or your custom
   domain, once attached).
9. **Redeploy.** The app should now serve real traffic.
10. **Seed the templates, then publish every template version in order.** Required — without the
   seed, no active `Template` row exists for any slug and every `createAudit` call fails. The
   publish steps are new template versions (`docs/spec.md` §5 versioning rules; in-progress audits
   stay pinned to the version they started on).

   **Run all six, in this order.** Each builds on the content the previous one published, and a
   publish script refuses to run if no active version exists yet:
   ```
   NODE_ENV=production DATABASE_URL="<the rotated production DATABASE_URL>" DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config prisma/seed.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-tierA-expansion.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-evidence-depth.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-evidence-backed-thresholds.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-runner-aligned-thresholds.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-stated-limits-thresholds.ts
   ```
   All six are idempotent: each checks whether the active version already carries its change and
   prints "Skipping" rather than publishing a duplicate, so re-running after a partial failure is
   safe.

   **Then verify you actually landed on v6**, because stopping short fails in a way that looks like
   a broken feature rather than a missing step:
   ```
   DIRECT_DATABASE_URL="<external connection string>" psql "$DIRECT_DATABASE_URL" -c 'SELECT slug, version FROM templates WHERE "isActive";'
   ```
   Every row must read version 6. Stopping short fails silently in several ways: an install
   that halts at v2 has templates whose items declare no structured-field schema, so every Tier B/C
   item falls back to note-only capture and the product appears to have lost its evidence capture;
   one that halts at v3 has the structured capture but the *superseded severity thresholds*, which
   is worse, because nothing about it looks wrong — findings are simply graded against retired card-
   network programmes and a fixed certificate-expiry rule that fires constantly on short-lived
   certificates; and one that halts at v4 shows consultants two rubrics that disagree with the
   ratings the product itself produces, which is worse than a wrong number because it invites them
   to override a correct rating by hand (`docs/releases.md` §3).

   `NODE_ENV=production` skips seeding the local dev login (`dev@closecheck.local`) — production
   accounts come from `/signup` instead.
11. **Backfill retention dates on any pre-existing engagements** (one-off, only relevant when
    deploying over a database that already holds data — skip on a fresh install):
    ```
    DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/backfill-retention-dates.ts
    DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/backfill-retention-dates.ts --apply
    ```
    Dry-run first (the default), then `--apply`. It only fills nulls on engagements already in a
    terminal deal stage and is idempotent. Without it, engagements that reached CLOSED or DEAD
    before the retention default existed keep their documents indefinitely — nobody would ever
    re-save them, so nothing else would set a date (`docs/spec.md` §8).

12. **Verify the deployment** — one command, from an environment holding the production
    variables:
    ```
    npm run verify:deployment
    ```
    It re-checks the steps above by exercising them rather than reading configuration: connects as
    all five narrow roles, confirms every org-owned table is actually isolated, checks the published
    template version against the newest one, writes and reads back and deletes a real object through
    the storage backend, retrieves every `STRIPE_PRICE_*` id from the Stripe account the key belongs
    to, and calls Resend.

    Most of what it catches is silent on a running server — a role left on the password the
    migrations put in this repository, a template published two versions behind, a bucket that
    accepts writes nobody can read back, a test-mode price id left behind after switching to live.
    The app boots and serves in every one of those states.

    It exits non-zero on failure and prints a **Start here** line naming which failure to fix first,
    because these failures are not independent — the Stripe webhook secret cannot be obtained before
    there is a public URL to register an endpoint against.

    It is safe to re-run against production at any time. It reads, and writes one object under a
    reserved prefix which it deletes. It prints no secrets — only whether each one is present and
    whether it works. It does **not** check the launch gates in `docs/releases.md` §5, which need
    evidence a person produces.

13. **Create the first real account** at `https://<your-domain>/signup` and confirm the full loop:
    create an engagement, start an audit, run Tier A checks, generate a report.

## Ongoing deploys

Every subsequent push runs `preDeployCommand` (`prisma migrate deploy`) automatically before the new
version takes traffic — no manual steps needed unless a migration adds a new narrow-privilege role
(rare; five roles exist today — app/auth/signup/portal/api), which would need step 6 repeated for
the new role.

`npm run verify:deployment` (step 12) is worth re-running after any deploy that adds a model, a
role, or a template version — those are the three changes whose deployment step is easy to skip and
whose omission the running app does not report. It takes a few seconds and is safe against
production.

## Local development: restart the dev server after a schema change

`next dev` does not reload the generated Prisma client. Running `prisma migrate dev` or
`prisma generate` updates `node_modules/.prisma/client` on disk, but a dev server started before
that keeps the old client in memory for the life of the process — so every query touching a new
column fails with `Unknown argument \`<field>\``, naming a field that demonstrably exists in both
the schema and the database.

It reads exactly like a broken migration and is not one. `npx prisma migrate status` will say the
database is up to date, the column will be present in `information_schema.columns`, and the same
query will succeed from any fresh process — which is what makes it cost an hour the first time.
**Restart the dev server.** This affects local development only; production and CI both start from a
fresh build.

A `predev` script runs `prisma generate` before `next dev`, so a server *started* after a migration
is always current. It cannot help a server that was *already running* when the migration landed —
nothing can, short of restarting it — so the symptom above is still worth recognising. It showed up
three times in one day across two people working the same tree, every time presenting as a bug in
whatever code had just been written.

One residue even that does not cover: a `prisma generate` run while `schema.prisma` was mid-edit
produces a client missing whatever had not been saved yet. A relation added in that window gives
`Unknown field '<name>' for include statement on model <Model>` — which reads exactly like a bad
migration, and survives a restart, because the generated client itself is incomplete rather than
stale. Re-run `prisma generate` and restart.

A third, which presents as a database bug and is not one: an integration test failing with

```
Transaction API error: Transaction already closed: A commit cannot be executed on an expired
transaction. The timeout for this transaction was 5000 ms, however 22626 ms passed since the
start of the transaction.
```

Twenty-two seconds for a transaction containing one `findUnique` and one `create` reads as a lock
or a pathological query. It is neither. Sampling `pg_stat_activity` while the run is in flight
shows the backend `idle in transaction`, waiting on `Client/ClientRead` — Postgres has finished and
is waiting for *Node* to send the next statement. The time is going to the event loop, not the
database.

What stalls Node is the open question, and the evidence points at something specific:
**`npm run build` running while the dev server is up.** A build rewrites `.next` underneath the
running server, which then stalls hard. Two sessions were working this tree; the failures appeared
while the other one was running builds through the day, and stopped as soon as it stopped — both
suites have been green since. A second session independently hit five failures of the same shape in
the same window.

The gentler explanation — `next dev` compiling a route on first hit while another request holds a
transaction open — is real but fits this evidence less well. The two tests that failed were not the
first in their file, and the failures sat at the harness ceiling (30059ms and 30203ms) rather than
at a plausible compile time.

Either way the conclusions are the same, and both are worth keeping:

- **Do not run `npm run build` while a dev server is serving tests.** It is not isolated from the
  dev server; they share `.next`. When two people (or two agent sessions) work one tree, that needs
  a convention rather than care, because the damage lands in the *other* person's run and looks
  like a bug in whatever they just wrote: whoever needs a production build says so, the other stops
  their dev server, and it is taken in turns. Nothing shares `.next` safely, so there is no
  cleverer arrangement than that.
- **Do not raise the transaction timeout to make this go away.** Five seconds is a reasonable alarm
  for transactions that should take milliseconds, and what it is reporting is an artifact of the
  environment rather than anything the production path does. CI has never seen it, because CI runs
  `npm start` against a production build.

Re-run, or run against `npm start`, and check first whether anything else is building.

A further trap in the same family, for anyone writing browser tests against a server action: reading
an input's value straight after the action can return what you typed rather than what was stored.
The action re-renders in place, and if the persisted value round-trips to something different (a
price canonicalised from "$20.50" to "20.50", say), a read taken before that render shows your own
input and looks exactly like a normalisation bug.

Two things make this worse than it first appears, and both cost debugging cycles here:

- **Waiting for network idle does not work under `next dev` at all.** The HMR websocket means the
  network never goes idle, so the wait either times out after 30 seconds or resolves at an
  arbitrary unrelated moment. Tests that use it pass and fail on alternate runs against unchanged
  code, which is the worst possible signal — it trains you to re-run rather than investigate.
- **Navigating away before a server action finishes CANCELS it.** So the obvious fix —
  re-navigate to the page and assert persistence against a fresh load — silently cancels the save
  when applied too early, and the page then correctly shows nothing saved. That presents as a
  persistence bug in code that is working perfectly.

The reliable signal is the action's own POST completing:

```ts
await Promise.all([
  page.waitForResponse((r) => r.request().method() === "POST"),
  form.locator('button[type="submit"]').click(),
]);
// only now is it safe to navigate and assert persistence
```

For an action you expect to be *refused*, wait on `waitForURL(/error=/)` instead — the redirect is
the completion signal in that case. `tests/integration/journey.itest.ts` has this as a
`submitAndSettle` helper with the reasoning at the call site.

Finally: `prisma migrate dev` may offer to reset the database, reporting drift. The hand-written
partial unique index on `templates` is not representable in `schema.prisma`, so dev-mode's shadow
comparison reads it as drift every time. `migrate status` and `migrate deploy` are both unaffected.
Write the SQL for such migrations by hand rather than accepting the reset — accepting it destroys
local data to fix a discrepancy that does not exist.

## Object storage

The app writes uploaded evidence, brand logos and generated report PDFs through one storage
boundary (`src/lib/storage/objectStore.ts`) with two backends. **Local disk is the default and
needs no configuration.** Naming a bucket switches to object storage; nothing else changes.

Local-on-a-mounted-volume remains a supported production configuration for an operator who
attaches a disk themselves and points `STORAGE_ROOT_DIR` at its mount — but `render.yaml` no longer
does that, and the app will not drift into it. In production with no `STORAGE_S3_BUCKET` set, every
storage operation is **refused** with the reason and the remedy until either the five `STORAGE_S3_*`
variables are set or `STORAGE_ACKNOWLEDGE_LOCAL=true` says, on purpose, that the local path is a
real volume. What a mount cannot give you either way is encryption at rest beyond whatever the
volume provides, or any redundancy: the volume is a single copy. That was a boot-time warning while
the blueprint mounted a disk; once it stopped, "local disk in production" came to mean the
container's ephemeral filesystem, and a log line nobody reads on a green deploy is not a safeguard
against losing every seller contract on the next one.

To move to object storage, set on the web service:

```
STORAGE_S3_BUCKET=closecheck-documents
STORAGE_S3_REGION=auto                 # the real region on AWS; "auto" suits Cloudflare R2
STORAGE_S3_ENDPOINT=...                # omit entirely for AWS S3
STORAGE_S3_ACCESS_KEY_ID=...           # omit both to use an instance role instead
STORAGE_S3_SECRET_ACCESS_KEY=...
```

Do **not** set `STORAGE_S3_SSE`. It is off by default and should stay that way unless a bucket
policy specifically denies uploads that lack the `x-amz-server-side-encryption` header.

That default was the other way round until 2026-09-23, and it is worth saying why it changed,
because the reasoning is what tells you whether to override it. **Cloudflare R2 rejects that header
outright** — its S3 compatibility page lists it as unsupported on PutObject, SSE-C only — so a
default of "always send it" made the first upload against R2 fail. And on **AWS S3 the header buys
nothing**: since 2023-01-05 S3 encrypts every new object with SSE-S3 (AES-256-GCM) automatically,
in every bucket. R2 likewise encrypts at rest unconditionally, with no opt-out. On both providers
the property holds either way; on one of them, asking for it fails the request.

Written against the S3 protocol rather than a named provider, so AWS S3, Cloudflare R2, Backblaze
B2, DigitalOcean Spaces and MinIO all work. The provider decision is an endpoint and a credential.

**Exercised against Cloudflare R2 on 2026-09-24**, in the order below, which is also the order to
repeat it in for any new bucket or provider. Run `npm run verify:deployment` first — it writes,
reads back, byte-compares and deletes a real object through whichever backend is configured, and
will tell you in seconds if the bucket, credentials, region or endpoint are wrong.

Then round-trip a file through the product itself, because that exercises the callers rather than
the storage seam — upload a document to an audit, download it back, then set that engagement to a
terminal stage with a past purge date and run
`npm run db:purge-expired-documents -- --engagement=<id>`. That covers write, read and delete, which
is the whole surface. The code's own docstring carries the same caveat and should lose it once this
has been done.

### Changing the storage backend on an installation that already holds documents

**Do not change `STORAGE_S3_BUCKET` on a running installation without doing this first.** The backend
is resolved per operation and nothing copies objects between backends, so pointing the application at
a new bucket leaves every existing document where it was while every database row goes on naming it.
The failure is silent and total, and it does not look like a failure: a report whose PDF is not in
the new bucket renders the portal's "not generated yet" state, which is indistinguishable from a
report that genuinely was never generated. A firm would conclude the product lost their work, and
they would be right.

This is a copy rather than a migration because the key scheme is backend-independent by design — the
same key names the same document whichever backend holds it. That property was built for exactly
this moment; nothing needs rewriting, only moving.

**1. Stop writes.** Scale the service to zero, or put it in maintenance. A document uploaded after
the copy starts and before the cutover lands in the old backend and is not carried across — which
reintroduces the same silent gap for one file, the hardest kind to notice.

**2. Copy, key for key.** From a machine with the storage root and credentials for the new bucket:

```
aws s3 sync "$STORAGE_ROOT_DIR"/ s3://$STORAGE_S3_BUCKET/ \
  --endpoint-url "$STORAGE_S3_ENDPOINT" --exact-timestamps
```

`rclone copy` works equally well. Do not add `--delete`: this is additive, and a flag that removes
what it does not recognise is the wrong instrument to point at a bucket of seller documents.

**3. Verify against the database, not against a file count.** A count can match while the one key a
consultant needs is missing, and a sample can pass while missing the same key. The bar worth meeting
is that **every key the database names resolves in the new backend**, because an orphaned row is the
entire failure mode:

```
npm run db:verify-storage-keys
```

It enumerates every key-bearing column — `reports.pdfStorageKey`, `reports.brandSnapshotLogoKey`,
`evidence.storageKey`, `consultant_orgs.brandLogoUrl` — issues a HEAD for each against the configured
backend, and exits non-zero naming any that do not resolve. Run it before cutover, with the new
backend configured, while the old one still holds the originals: a failure then is recoverable by
re-running the copy, and the same failure after cutover is a support incident.

**4. Cut over and re-verify.** Set the variables, restart, run `npm run verify:deployment` (which
round-trips a real object), then `npm run db:verify-storage-keys` once more against the live service.

**5. Keep the old storage until you are sure.** The copy is additive and the originals are the only
remaining copy of anything the sync missed. Delete the old root after a deliberate decision, not as
part of the cutover.

**On a fresh install none of this applies** — there are no objects yet, and setting the variables
before the first upload is the whole procedure.

### The S3 credentials are the R2 token in another encoding

R2's S3 credentials are derived, not issued: the **Access Key ID is the R2 API token's id**, and the
**Secret Access Key is `sha256(token value)`** as a hex string. That is a fact about R2's design,
verified here by minting a token through Cloudflare's API and completing the round trip with the
derived pair — and it has two consequences the words "hash" and "derived" invite you to get wrong:

- The derived secret is **not a lesser artefact** than the token. Anyone holding it has the token's
  full S3 authority; they are the same secret in two encodings. Handle `STORAGE_S3_SECRET_ACCESS_KEY`
  exactly as you would the token, not as something safely downstream of it.
- **Rotating means re-deriving.** A new token is a new id and a new value, so both S3 variables change
  together; rotating one without the other is a credential that fails, not one that degrades.

The production token is named `closecheck-web-prod` in Cloudflare → R2 → Manage API Tokens
(Object Read & Write, scoped to the one bucket), so it can be found and rotated by someone who was
not there when it was made.

### Local development must not point at the production bucket

A local `.env` that names the production bucket makes every local integration run write into it and
— worse — every fixture teardown leaves orphaned objects behind, because the suites delete their
orgs through the database and nothing deletes the objects those rows named. This happened once
during the R2 proving run: one 69-byte test upload survived its org. Keep local development on the
local-disk backend (leave `STORAGE_S3_*` unset in `.env`); the production values live on the
service. Use `STORAGE_S3_*` locally only for a deliberate, one-off proving run like the one in
"First deploy" step 12, and clear them afterwards.

### Objects that no row names — and why removing evidence now deletes the file

Every product path finds a document by joining through the row that names it: the download route,
the portal, the retention purge. An object whose row is gone is therefore not "waiting for the
purge" — it is unreachable by everything, permanently, with nothing in the database that knows it
is there. Two things produce that state, and both were demonstrated against the real bucket on
2026-09-24:

- **Removing evidence.** `deleteEvidence` used to delete the row and deliberately leave the object,
  on the reasoning that the purge would collect it. The purge cannot; it never sees a key without a
  row. Since 2026-09-24 removing evidence deletes the object too, row first and then object, with no
  grace period — a consultant who attaches the wrong seller's contract and removes it needs it
  gone, and `docs/spec.md` §8's premise is that documents do not outlive the engagement, let alone
  the customer. If the object delete fails after the row has gone, that is recorded to
  `error_events` (`evidence-delete-object`) and left for the sweep below.
- **Deleting an organisation.** The cascade removes every row in one statement; there is no code on
  that path to put a hook in, so every object the org ever stored is orphaned.

```
npm run db:sweep-orphaned-objects            # report: keys the backend holds that no row names
npm run db:sweep-orphaned-objects -- --apply # delete them
```

It is `db:verify-storage-keys` run in the other direction — that one finds rows whose object is
missing, this finds objects whose row is missing — and it is exact for the same reason: the failure
is a single document, and a count cannot see it. It never touches the reserved `_deployment-check/`
prefix. Run it after deleting an organisation, after any `evidence-delete-object` error, and on a
schedule if you want the property to hold without someone remembering. On a development machine it
will report a great deal: integration suites delete their fixture orgs through the database and
leave every object those rows named, which is the same mechanism, harmlessly.

**Two things the purge does that matter more with a bucket than with a directory.** It refuses to
start unless the backend answers, so a misconfigured one cannot get as far as deleting database
rows whose files it never found. And a file it cannot find keeps its row and fails the run — which
is the protection against the case no pre-flight can catch, a backend that is perfectly reachable
and simply the wrong bucket. An empty bucket answers exactly like the right one; the missing-file
rule is what stops that becoming data loss.

## Deploying a disclaimer change

`ConsultantOrg.disclaimerAcknowledgedAt` records that a named owner reviewed the disclaimer **as it
read on that date**. So any migration that changes the disclaimer text also clears that column —
otherwise the record asserts someone reviewed language they never saw, which is worse than having no
record at all.

**The consequence on a live deployment: report generation refuses for every firm until that firm's
owner re-acknowledges on Settings.** That is the gate working rather than breaking (`spec.md` §6
makes disclaimer review a required step, not silent boilerplate), but it is a visible interruption
to every customer at once and it happens the moment the migration runs.

So when deploying a release that carries such a migration — `releases.md` §3 flags them as
legal-content events — tell customers first, deploy outside their working hours if you can, and
expect support contact from anyone mid-audit. The block is per-firm and clears with one click by an
owner; a member cannot clear it, and the blocked-report message names the owner rather than
instructing the reader.

## Known gaps this runbook does not solve

- **Object storage is still local disk on a persistent volume**, not real S3-compatible storage —
  fine for a small number of design partners, but `src/lib/storage/local.ts`'s docstring is explicit
  that this needs to change before real seller/buyer documents pile up at any scale, and before
  running more than one web service replica (a second replica would not see the first's files).
- **Billing is implemented but ships dark** (Phase 2.5) — Stripe checkout, the audit-credit ledger,
  and overage invoicing all exist, but `BILLING_ENFORCEMENT` defaults to `false`, so nothing is
  charged or blocked until you provision Stripe keys and flip it (see the Stripe section below).
  Until then the pricing numbers remain the untested placeholders from `docs/spec.md` §9.
- **The report disclaimer text is unreviewed by counsel** — flagged in-app on the settings page,
  unchanged by this runbook.

## Transactional email (Resend — Phase 2.5)

Without configuration the app still works: every system email (team invite, portal-link share,
receipt) is recorded in the `email_messages` table with status `LOGGED` and echoed to the server
console, and the in-app relays (invite temp-password display, copy-paste portal URL) remain the
guaranteed path. To actually deliver email:

1. Create a Resend account (resend.com) and add your sending domain under Domains; add the DKIM/SPF
   DNS records Resend shows you and wait for verification.
2. Create an API key (Full Access → Sending) and set it as `RESEND_API_KEY` on the web service.
3. Set `EMAIL_FROM` to a verified-domain sender, e.g. `CloseCheck <notifications@yourdomain.com>`.
4. Redeploy. Delivery status per message is visible in the `email_messages` table (`SENT` with the
   provider id, or `FAILED` with the provider error).

**Sandbox-sender caveat (verified 2026-09-22):** before you verify a custom domain, Resend only lets
you send from its shared `onboarding@resend.dev` sender, and that sender **only delivers to your own
Resend account's email address** — every other recipient is accepted by the API (`SENT`) but not
delivered. This is fine for a smoke test but means real team-invite / portal-link / receipt emails to
clients won't arrive until you own a sending domain and complete step 1's DNS verification. Treat
domain verification as a required step before onboarding a real design partner, not a deploy blocker.

## Billing (Stripe — Phase 2.5)

Without configuration the app runs in grace mode: no checkout surface appears on Settings, no
audit-credit enforcement happens, and audits are created freely (consumption is still recorded for
later measurement). To turn billing on:

1. Create a Stripe account and, in **test mode** first, create five Prices under one or more Products:
   four recurring subscription prices (Solo monthly, Solo annual, Team monthly, Team annual) and one
   one-off price used for batched audit-overage invoice items. Suggested test amounts per `spec.md`
   §9 as revised (all still awaiting the Phase 0 head-to-head test, so keep them changeable): Solo
   ~$35/mo or ~$348/yr, Team +$25/seat, overage in the $99–149 band.

   **The two Team prices are per ADDITIONAL SEAT, not per plan.** §9 defines the Team tier as
   "additional seats ... on top of the base", so a Team subscription is billed as the Solo price
   plus one per-seat line for every seat beyond the first — which is why a one-person Team org costs
   exactly what Solo costs. Creating the Team prices as whole-plan amounts makes a firm pay less
   than a solo consultant and every extra seat free; that was a real bug, fixed 2026-09-22.
2. Set on the web service: `STRIPE_SECRET_KEY`, and the five price ids —
   `STRIPE_PRICE_SOLO_MONTHLY`, `STRIPE_PRICE_SOLO_ANNUAL`, `STRIPE_PRICE_TEAM_MONTHLY`,
   `STRIPE_PRICE_TEAM_ANNUAL`, `STRIPE_PRICE_AUDIT_OVERAGE`. Optionally override the included-audit
   counts with `BILLING_INCLUDED_AUDITS_MONTHLY` / `BILLING_INCLUDED_AUDITS_ANNUAL` (defaults 3 / 6),
   and the Team seat allowance with `BILLING_TEAM_MAX_SEATS` (default 5). On Team plans the included
   audit bundle is multiplied by the seat count at grant time, per §9's tier table.
3. In the Stripe dashboard, add a webhook endpoint pointing at
   `https://<your-domain>/api/stripe/webhook`, subscribed to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.paid`. Copy its
   signing secret into `STRIPE_WEBHOOK_SECRET`. The endpoint verifies this signature and resolves the
   org from server-set customer/subscription metadata — it trusts nothing else.
4. Redeploy. `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` both present makes checkout appear on
   Settings for account owners. Enforcement (blocking full audits when out of credits, and creating
   billable overage invoice items) stays **off** until you set `BILLING_ENFORCEMENT=true` — do that
   only after a real test charge and a real refund have each round-tripped end-to-end
   (`docs/releases.md` §5 launch gate). Ledger and subscription state are visible per-org on Settings.
5. Switch to Stripe **live mode** and repeat steps 1–3 with live keys/prices when going to real
   billing; keep `BILLING_ENFORCEMENT=false` through the first live smoke test, then flip it.
