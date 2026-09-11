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

## Application (Phase 1 MVP scaffold)

Next.js (App Router) + TypeScript + Postgres. Implements the core loop from `docs/roadmap.md` Phase
1: create or edit an Engagement (including adding a domain after the fact — Tier A automation is
otherwise permanently blocked for an Engagement created without one), run the Restaurant/online-
ordering Template through Tier A (real WHOIS/DNS/SSL/CMS checks), Tier B/C manual finding capture
(including document upload and the transferable/penalty structured fields for contract items), a
consultant override on the computed rating, and a whitelabeled PDF report — every severity badge,
including the report's, shows rated/total coverage so a not-yet-checked audit never reads as
"verified Green." Document retention (`docs/spec.md` §8) is consultant-configurable per Engagement
(a purge date field) and enforced by `npm run db:purge-expired-documents`, run manually or on a cron
— nothing runs it automatically yet. Not yet built: self-serve billing, the client portal (Phase 3),
the other three templates.

**Tagged `v0.1.0`** — Phase 1 MVP, all engineering deliverables done and verified via full UI
testing (browser session, not just unit tests). The phase's actual exit criteria — a design partner
completing a real audit and sending the PDF to a real buyer — is a validation event, not code, and
remains open.

### Local setup

```bash
npm install
docker compose up -d          # local Postgres — see note on ports below
npm run db:migrate            # applies schema + row-level security policies + creates DB roles
npm run db:seed               # seeds the Restaurant template and a dev login
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

### Database roles — this matters, read before changing connection strings

The app uses **three** separate Postgres roles, not one (see `prisma/migrations/`):

| Role | Used by | Grants |
|---|---|---|
| `closecheck` (superuser, `DIRECT_DATABASE_URL`) | Prisma CLI only (`migrate`, `studio`) | Everything — needed for schema changes |
| `closecheck_app` (`DATABASE_URL`) | The running application, via `src/lib/db/scoped.ts` | CRUD on all tables, constrained per-row by the RLS policies |
| `closecheck_auth` (`AUTH_DATABASE_URL`) | Only `src/lib/auth/db.ts`, for the sign-in email lookup | `SELECT` on `users` only |

**Why:** row-level security (`docs/spec.md` §8's tenant-isolation requirement) is silently bypassed
for any Postgres role with the superuser or `BYPASSRLS` attribute — which the Docker Postgres image's
bootstrap role always has. Running the app against that role would make every RLS policy a no-op
without any error to tell you so. This was a real bug during this scaffold's own build, caught by
`npm run db:verify-rls` — run that script after touching anything in `prisma/migrations/` or
`src/lib/db/scoped.ts` to confirm tenant isolation still actually holds, not just that the code compiles.

### Local object storage

`src/lib/storage/local.ts` writes generated PDFs to `.local-storage/` (gitignored) instead of real
object storage. Fine for local dev; replace before any real seller/buyer data touches this — see the
comment at the top of that file and `docs/spec.md` §10.
