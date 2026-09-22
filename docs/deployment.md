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
- **Evidence/logo storage** (`src/lib/storage/local.ts`) currently writes to local disk — an
  explicit, flagged placeholder for real object storage (see that file's docstring), not yet built.
  Local disk only persists across requests on a platform with a long-running container and a
  persistent volume, not a stateless function whose filesystem resets per-invocation.

Render, Fly.io, Railway, or a plain VPS all work — anything that runs a container long-lived with an
attachable persistent disk. This runbook assumes Render specifically (`render.yaml` at repo root is
a Render Blueprint), since it bundles Docker + persistent disk + managed Postgres in one place with
infrastructure-as-code support.

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
   a live price). Neither has a permanent free tier once a persistent disk is attached.
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

8. **Set `NEXTAUTH_URL`** to the `*.onrender.com` URL Render assigned the service (or your custom
   domain, once attached).
9. **Redeploy.** The app should now serve real traffic.
10. **Seed the templates, then publish every template version in order.** Required — without the
   seed, no active `Template` row exists for any slug and every `createAudit` call fails. The
   publish steps are new template versions (`docs/spec.md` §5 versioning rules; in-progress audits
   stay pinned to the version they started on).

   **Run all four, in this order.** Each builds on the content the previous one published, and a
   publish script refuses to run if no active version exists yet:
   ```
   NODE_ENV=production DATABASE_URL="<the rotated production DATABASE_URL>" DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config prisma/seed.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-tierA-expansion.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-evidence-depth.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-evidence-backed-thresholds.ts
   ```
   All four are idempotent: each checks whether the active version already carries its change and
   prints "Skipping" rather than publishing a duplicate, so re-running after a partial failure is
   safe.

   **Then verify you actually landed on v4**, because stopping short fails in a way that looks like
   a broken feature rather than a missing step:
   ```
   DIRECT_DATABASE_URL="<external connection string>" psql "$DIRECT_DATABASE_URL" -c 'SELECT slug, version FROM templates WHERE "isActive";'
   ```
   Every row must read version 4. Stopping short fails silently in two different ways: an install
   that halts at v2 has templates whose items declare no structured-field schema, so every Tier B/C
   item falls back to note-only capture and the product appears to have lost its evidence capture;
   one that halts at v3 has the structured capture but the *superseded severity thresholds*, which
   is worse, because nothing about it looks wrong — findings are simply graded against retired card-
   network programmes and a fixed certificate-expiry rule that fires constantly on short-lived
   certificates (`docs/releases.md` §3).

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

12. **Create the first real account** at `https://<your-domain>/signup` and confirm the full loop:
    create an engagement, start an audit, run Tier A checks, generate a report.

## Ongoing deploys

Every subsequent push runs `preDeployCommand` (`prisma migrate deploy`) automatically before the new
version takes traffic — no manual steps needed unless a migration adds a new narrow-privilege role
(rare; five roles exist today — app/auth/signup/portal/api), which would need step 6 repeated for
the new role.

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

A second trap in the same family, for anyone writing browser tests against a server action: reading
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
