# CloseCheck

Tech due-diligence audit tooling sold to M&A / QoE / acquisition consultants — not to acquisition
buyers directly. Structured three-tier audit workflows, whitelabeled report generation, and (from
Phase 3) a client-facing portal, for pre-purchase technology assessments on small business
acquisitions ($200k–2M deal band).

See [`docs/idea.md`](docs/idea.md) for where this comes from, [`docs/spec.md`](docs/spec.md) for the
product specification, [`docs/roadmap.md`](docs/roadmap.md) for the phased build plan, and
[`docs/releases.md`](docs/releases.md) for how it ships.

See [`CLAUDE.md`](CLAUDE.md) for how work on this repo is organized (project-specific skills for
spec/roadmap/release/methodology/design/review work, and how to combine them).

## Application

Next.js (App Router) + TypeScript + Postgres. The full consultant loop is built: sign up, create an
Engagement, run an Audit against a business-type Template tier by tier, and produce a whitelabeled
PDF report for a buyer.

- **Four Templates**, all at v3: restaurant/online-ordering, salon/booking, franchise-location,
  general-ecommerce. Template versions are pinned per Audit — an audit started on v2 keeps reporting
  v2 after v3 publishes (`docs/spec.md` §5).
- **Tier A** automated checks against real data sources: RDAP domain lookup (with legacy WHOIS
  fallback), DNS, TLS, CMS fingerprint, SPF/DKIM/DMARC, MX, and HTTPS hygiene.
- **Tier B/C** structured evidence capture, with per-item field schemas declared on the template,
  document upload with type and size validation, and consultant-attested findings. No Tier C
  credential handling — a standing product decision, not a gap (`docs/spec.md` §4).
- **Reports** with a cover page, running header/footer, an executive summary naming what drove the
  rating, colourblind-safe severity encoding, and PDF export. Every severity badge shows rated/total
  coverage, so an audit where nothing has been checked never reads as "verified Green."
- **Client Portal**: revocable magic-link report sharing that needs no account, plus an access trail
  letting the consultant see when their report was opened, and whether by one viewer or several.
- **Billing**: Stripe checkout and portal, annual-lead pricing with bundled audit credits, per-seat
  Team plans, and overage batched into a monthly rollup rather than charged per audit. Ships dark —
  `BILLING_ENFORCEMENT` is off until the launch gates in `docs/releases.md` §5 are met.
- **Read-only API and signed webhooks**, org-scoped and RLS-enforced — see [`docs/api.md`](docs/api.md).
  Also shipped dark, pending a firm that asks for it.

What remains is largely not code: see [`docs/BLOCKED.md`](docs/BLOCKED.md) for the work gated on
live credentials, a deployment, or real design partners. Build state runs well ahead of validation
state, which `docs/roadmap.md` records deliberately rather than papering over.

## Local setup

```bash
npm install
docker compose up -d          # local Postgres — see note on ports below
npm run db:migrate            # applies schema + row-level security policies + creates DB roles
npm run db:seed               # seeds the templates and a dev login
npm run db:publish-tiera-expansion   # template v2
npm run db:publish-evidence-depth    # template v3 — without this, Tier B/C capture falls back to note-only
npm run dev
```

Sign in at `http://localhost:3000/login` with `dev@closecheck.local` / `devpassword123` (from
`prisma/seed.ts` — local dev only, not a real credential).

**Ports:** `docker-compose.yml` maps Postgres to host port `55432`, not the default `5432` — this
repo was built on a machine with other unrelated Postgres instances already bound to `5432`/`5433`.
Change it back to `5432:5432` if nothing else on your machine needs it; either way, keep
`docker-compose.yml` and the `DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_DATABASE_URL` ports in `.env`
in sync.

**PDF report generation** uses Playwright/Chromium. Run `npx playwright install chromium` once. In a
sandboxed environment where that can't fetch a browser binary, set `PLAYWRIGHT_CHROMIUM_PATH` in
`.env` to a system Chrome/Chromium binary instead (see `.env.example`).

## Testing

```bash
npm test                  # unit suite — no database, no server, runs in about a second
npm run test:integration  # needs a live Postgres AND a running app server
```

The integration suite drives a real server over HTTP and a real browser, because two of the launch
gates in `docs/releases.md` §5 explicitly refuse to be satisfied by code inspection. It covers
cross-org isolation at the RLS layer, webhook payload content, API pagination and rate limiting, the
portal access trail, and a full browser journey from signup through to an anonymously-viewed report.
Specs use an `.itest.ts` suffix so the unit suite never picks them up.

The Stripe billing end-to-end run additionally needs an `sk_test_` key; without one it fails rather
than skipping, unless `CLOSECHECK_SKIP_STRIPE_E2E=true` says the skip is deliberate. A suite that
skips itself quietly is worse than no suite when a launch gate cites it as evidence.

`.github/workflows/ci.yml` runs all of it on push, with the five `db:verify-*` scripts executed
before the app is even built — if tenant isolation is wrong, nothing else about that run matters.

**Run the integration suite against a production build, not `next dev`.** CI does
(`npm run build && npm start`), and it is the reliable way to run it locally too. Against a dev
server the browser journey can fail spuriously: `next dev` compiles a route on its first request, so
a run that coincides with someone editing files hits compile latency and times out, producing a
failure that looks like a real regression and disappears on the next run. If a journey test fails
once and passes immediately afterwards with nothing changed, that is what happened.

## Operations

```bash
npm run ops:dashboard          # renders a self-contained HTML dashboard of the §11 funnel
npm run ops:errors             # groups error_events by normalized message
npm run ops:backup-drill       # dumps, restores to a scratch DB, and verifies RLS and grants survived
npm run db:purge-expired-documents
```

These are CLI tools on the superuser role, deliberately not an in-app admin surface: a cross-org
read path in the web tier would be new tenant-isolation attack surface in a product whose documented
core risk (`docs/spec.md` §8) is exactly that.

## Database roles — this matters, read before changing connection strings

The app uses **six** separate Postgres roles, not one (see `prisma/migrations/`):

| Role | Used by | Grants |
|---|---|---|
| `closecheck` (superuser, `DIRECT_DATABASE_URL`) | Prisma CLI only (`migrate`, `studio`) | Everything — needed for schema changes |
| `closecheck_app` (`DATABASE_URL`) | The running application, via `src/lib/db/scoped.ts` | CRUD on all tables, constrained per-row by the RLS policies |
| `closecheck_auth` (`AUTH_DATABASE_URL`) | Only `src/lib/auth/db.ts`, for the sign-in email lookup | `SELECT` on `users` only |
| `closecheck_signup` (`SIGNUP_DATABASE_URL`) | Only `src/lib/auth/signupDb.ts` — creating an org before any session exists | `INSERT` on `consultant_orgs`, `users`, `metric_events`, `error_events`. No `SELECT` at all |
| `closecheck_portal` (`PORTAL_DATABASE_URL`) | Only `src/lib/portal/db.ts` — the no-account client portal | `SELECT` on `client_portal_links` and `reports`, `INSERT` on `portal_access_log` |
| `closecheck_api` (`API_DATABASE_URL`) | Only `src/lib/api/auth.ts` — resolving a bearer token before any org is known | `SELECT` on `api_keys`, plus `UPDATE` on that table's `lastUsedAt` column alone |

Each narrow role exists for one cross-tenant lookup that has to happen *before* an org is known —
sign-in by email, signup with no session yet, a portal token, an API key. Everything after that point
goes through `closecheck_app` under `withOrgScope`. The pattern is deliberate: rather than granting
the app role a capability it would need only for those moments, each moment gets a role that can do
nothing else.

**Why:** row-level security (`docs/spec.md` §8's tenant-isolation requirement) is silently bypassed
for any Postgres role with the superuser or `BYPASSRLS` attribute — which the Docker Postgres image's
bootstrap role always has. Running the app against that role would make every RLS policy a no-op
without any error to tell you so. This was a real bug during this scaffold's own build, caught by
`npm run db:verify-rls` — run that script, and its four siblings (`db:verify-signup-portal-roles`,
`db:verify-api-role`, `db:verify-template-versioning`, `db:verify-billing-credits`), after touching
anything in `prisma/migrations/` or `src/lib/db/scoped.ts`, to confirm tenant isolation still
actually holds rather than merely compiling. CI runs all five before it builds the app.

## Local object storage

`src/lib/storage/local.ts` writes generated PDFs to `.local-storage/` (gitignored) instead of real
object storage. Fine for local dev; replace before any real seller/buyer data touches this — see the
comment at the top of that file and `docs/spec.md` §10.
