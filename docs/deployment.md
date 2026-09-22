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
7. **Set `NEXTAUTH_URL`** to the `*.onrender.com` URL Render assigned the service (or your custom
   domain, once attached).
8. **Redeploy.** The app should now serve real traffic.
9. **Seed the templates** (required — without this, no active `Template` row exists for any slug and
   every `createAudit` call fails), then publish the Phase 4 Tier A expansion versions
    (`docs/spec.md` §13.1 — new template versions, in-progress audits stay pinned):
   ```
   NODE_ENV=production DATABASE_URL="<the rotated production DATABASE_URL>" DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config prisma/seed.ts
   DIRECT_DATABASE_URL="<external connection string>" npx tsx -r dotenv/config scripts/publish-tierA-expansion.ts
   ```
   `NODE_ENV=production` skips seeding the local dev login (`dev@closecheck.local`) — production
   accounts come from `/signup` instead.
10. **Create the first real account** at `https://<your-domain>/signup` and confirm the full loop:
    create an engagement, start an audit, run Tier A checks, generate a report.

## Ongoing deploys

Every subsequent push runs `preDeployCommand` (`prisma migrate deploy`) automatically before the new
version takes traffic — no manual steps needed unless a migration adds a new narrow-privilege role
(rare; five roles exist today — app/auth/signup/portal/api), which would need step 6 repeated for
the new role.

## Known gaps this runbook does not solve

- **Object storage is still local disk on a persistent volume**, not real S3-compatible storage —
  fine for a small number of design partners, but `src/lib/storage/local.ts`'s docstring is explicit
  that this needs to change before real seller/buyer documents pile up at any scale, and before
  running more than one web service replica (a second replica would not see the first's files).
- **Payment processing is not implemented** (`docs/spec.md` §9's pricing is a placeholder) — the
  pricing page and signup flow do not charge anything.
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
