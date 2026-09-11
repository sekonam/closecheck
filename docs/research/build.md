# CloseCheck — technical build scope

Reads against `docs/idea.md`, `docs/spec.md`, and `docs/roadmap.md`. Those documents have already
made several scope decisions (single template for MVP, no client portal in Phase 1, no credential
vault ever in v1) — this document costs those decisions technically, validates or revises them
where the technical cost changes the calculus, and adds the concrete stack/architecture/effort
detail that didn't exist yet. Where this document's numbers diverge from `roadmap.md`'s own
estimates, that's flagged explicitly rather than silently overridden.

**Assumed developer familiarity:** competent solo full-stack developer, strong in Next.js/
TypeScript/Postgres/Tailwind, no prior production experience with Supabase RLS specifically or
headless-browser PDF pipelines. Ranges below are widened on those two line items to reflect that.

---

## 1. Verdict

**Weeks, not days — and the existing roadmap's 6–10 week Phase-1 estimate is slightly optimistic.**
A bottom-up build of the true MVP (single template, checklist engine, PDF report, no self-serve
billing, no portal) lands at **40–58 developer-days (8–12 weeks)** for a solo developer with the
stated familiarity gaps. The gap between that and the roadmap's 6-week floor is almost entirely
in two places: multi-tenant RLS done correctly (not just "it works for one org"), and getting a
whitelabeled, multi-page PDF to a genuinely client-ready visual bar. Neither is optional — both are
load-bearing to the product's actual pitch ("client-ready deliverable," "no cross-org data leak in
an NDA-covered industry").

## 2. MVP scope — what a stranger would actually pay for

**In scope, confirmed correct as scoped in `spec.md`:**

- Checklist engine: **one** hardcoded template (Restaurant/online-ordering), Tier A/B/C structure,
  automated Tier A checks wired to real data sources (WHOIS/DNS/SSL/CMS fingerprint — not mocked),
  Tier B document upload + structured-field capture, Tier C consultant-attested findings (no live
  credential handling — see §6).
- Report generation: traffic-light executive summary, tiered findings detail, whitelabel cover/
  footer, PDF export, severity roll-up logic with consultant override.
- Multi-tenant auth and data isolation from day one, even at 2–3 orgs (`spec.md` §8 is explicit
  this isn't deferrable, and it's right — retrofitting RLS after the data model calcifies across
  evidence/reports is a rewrite, not a patch).

**Deliberately out of MVP, and this document agrees with `spec.md`/`roadmap.md`'s reasoning:**

- **Client-facing portal.** See the dedicated analysis in §3 — this is the question the task
  specifically asked to pressure-test, and the existing decision holds up.
- **Template library** (salon, franchise, e-commerce). One template, not four, is the right MVP cut
  — each additional template is real domain-research time (learning that vertical's actual
  contract/vendor landscape), not just dev time, and building three unvalidated templates before
  one is proven in a real deal repeats the exact "guessed feature list" risk `idea.md` was written
  to avoid.
- **Self-serve signup and subscription billing.** Not flagged in the task, but worth naming
  explicitly: `roadmap.md` Phase 1 is white-glove/manual onboarding for 2–3 design partners, which
  means Phase 1 as scoped **does not yet take money in the "thinnest thing a stranger would pay
  for" sense** — design partners run free or discounted. If the goal is the actual thinnest
  money-taking version, add one line item: a Stripe Payment Link or manually-sent invoice per
  engagement/seat, no subscription webhooks, no dunning, no proration logic. That's ~1–2 days, not
  the 5–7 days full subscription billing costs (see §5, Tier 1). Build real subscription billing
  once there are enough paying accounts that manual invoicing is a monthly chore, not before.
- Live credential storage/proxying for Tier C — never (per `spec.md` §4), not just deferred. This
  is the single biggest complexity-avoidance decision in the whole spec and it's correct: a
  credential vault (secrets storage, rotation, scoped proxying to third-party admin panels) would
  have been the actual hardest technical problem in this build. Removing it changes the hard-parts
  ranking (§6).

## 3. The client-portal decision, pressure-tested

**Question asked: is "my client can log in and see findings" the actual differentiator, or is a
clean PDF emailed like every other consultant already does the real value?**

The PDF is the real value, for the first sale. Reasoning:

- The buyer-side workflow in this industry is already PDF-and-email — QoE reports, legal opinions,
  broker packages all arrive this way today (this is the default the source research documented,
  not a gap CloseCheck needs to close). A consultant's willingness to pay is driven by *not having
  to build the methodology and report template themselves*, and by looking more credible/thorough
  than an ad-hoc process — both satisfied by checklist engine + report generation alone.
- A portal adds a second user population (the buyer) with its own auth, support surface, and
  security blast radius, before there's any confirmed evidence a buyer wants to click around
  findings rather than read a PDF and ask their consultant questions on a call — exactly the
  reasoning `spec.md` §7 already gives, and it's sound.
- Where a portal *would* start to matter: Tier C's live-access findings are inherently
  slow-drip (the source methodology research put one audit's Tier B/C calendar span at 1.5–3
  weeks even though the work-hours are ~6–12) — a buyer waiting on that timeline has a real reason
  to want live status instead of silence. That's a legitimate future differentiator, but it's a
  *retention/expansion* lever for consultants already paying, not an activation lever for the
  first sale.

**Recommendation: keep the portal out of MVP, as scoped — but the specific shape `spec.md` already
chose (magic-link, no buyer account, scoped read-only view of one report) is the right shape when
it is built.** It sidesteps the expensive part (a second authenticated user class with its own
signup/password-reset/session management, doubling the auth surface) while still buying the "not
just a PDF" positioning cheaply: a signed, expiring URL to the same report data, generated for
free alongside the PDF. Costed in §5, Tier 2 — it's materially cheaper (10–15 days) than a full
authenticated client-account portal would have been (would have priced at 20–30+ days), precisely
because of that design choice.

## 4. Stack and architecture

| Layer | Choice | One-line reason |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Already confirmed; server components fit the report-rendering reuse principle in `spec.md` §10 (same Finding data drives on-screen review and PDF). |
| Hosting | Vercel | Native Next.js fit, zero-ops deploys. Confirmed suitable: Pro plan functions now default to 300s with a **generally-available 800s max** (extended-duration 30 min is beta) — comfortably covers a report-generation request without needing a separate long-running worker. `EVIDENCE` (Vercel docs, fetched 2026-09-11). |
| Database + Auth + Storage | **Supabase** (Postgres, Pro tier $25/mo: 8GB DB included, 100GB file storage included) | One vendor bill for three subsystems that need to work together tightly (RLS policies reference `auth.uid()` natively; Storage access policies compose with the same RLS model). `EVIDENCE` (Supabase pricing, fetched 2026-09-11). Rejected alternatives: **Neon** is Postgres-first with auth/storage as newer, still-beta bundled services (`EVIDENCE`, Neon pricing fetched 2026-09-11) — less mature integration for this specific RLS-heavy design; **PlanetScale** is Vitess/MySQL-based post-2024, no native row-level-security primitive equivalent to Postgres RLS, wrong fit for a design where tenant isolation is explicitly the top security priority (`spec.md` §8). |
| Auth mechanism | Supabase Auth (email/password + magic link), custom `org_members` table for org/role mapping | Native RLS integration (`auth.uid()` in policies) beats Clerk's superior org/invite UX for this build: Clerk's B2B organization add-on is **$100/mo extra** on top of its base tier (`EVIDENCE`, Clerk pricing fetched 2026-09-11) for features (unlimited org members, SSO) this MVP's 2–10-person firms don't need yet — Clerk's free/Pro org limits (100 orgs, 20 members each) would actually cover this scale, but paying for and wiring a second auth vendor alongside Supabase, when Supabase Auth already does the job and keeps RLS simple, is avoidable cost and complexity. Revisit if invite/SSO UX becomes a real support burden. |
| Report rendering | Server-rendered HTML report route (reuses on-screen Finding components) → **Browserless.io** (hosted headless Chrome, $25/mo Prototyping tier = 20,000 units/month) for HTML→PDF conversion | Full CSS fidelity, matches `spec.md` §10's "same Finding data drives on-screen review and PDF" principle directly — a real HTML/CSS pipeline can literally reuse Tailwind components between the two surfaces, `@react-pdf/renderer` cannot (it renders to PDF primitives via a CSS-subset, not real HTML/CSS, so the report UI would be a parallel, hand-maintained component tree). Running Puppeteer/chromium inside a Vercel function directly is avoidable packaging fragility (trimmed chromium builds, cold-start latency) for $25/mo saved elsewhere. `EVIDENCE` (Browserless pricing, fetched 2026-09-11). **Flag as unconfirmed:** actual output quality/fidelity for a real multi-page report with tables, logo, and page breaks — propose a one-day spike rendering one representative report through this exact pipeline before building the checklist engine around it. |
| Background jobs | Vercel Cron (scheduled) + a lightweight durable-job tool (Inngest or Trigger.dev, both have free tiers sufficient at this scale) | Report generation fits in a single request at this volume (see hosting row), but retries (Browserless hiccup, transient failure) and "email when report is ready" are worth a real job queue rather than best-effort inline logic — cheap insurance for a product whose pitch depends on reliability. |
| Transactional email | Resend or Postmark, not Supabase's built-in SMTP | Supabase's default email sending is rate-limited and not meant for production deliverability — a known gotcha, replace it from day one rather than discovering it at the first real invite-email bounce. |
| Payments | Stripe — **Payment Links / manual invoicing** for MVP, full Subscriptions + webhooks deferred to Tier 1 (§5) | Matches §2's "thinnest thing that takes money" cut: 2–5 paying design-partner-adjacent accounts don't need proration/dunning automation. |

**Monthly infra cost at 10–20 active consultant accounts:** Vercel Pro (~$20/mo/seat, usage likely
within plan credits at this volume) + Supabase Pro ($25/mo) + Browserless Prototyping ($25/mo,
20k units against a realistic 500–2,000 units/mo at this scale) + Resend free/low tier ($0–20/mo)
+ Sentry (free or ~$26/mo team tier) + Inngest/Trigger.dev (free tier sufficient) ≈ **$70–130/mo**,
before Stripe's per-transaction fee. `INFERENCE` from each vendor's published pricing tier and this
product's low document/report volume at that account count — not a measured bill.

### Architecture sketch

```
Consultant browser
   │  (Next.js Server Actions / Route Handlers, Supabase session)
   ▼
Next.js app (Vercel)
   │
   ├─▶ Supabase Postgres (RLS-scoped by org_id) — orgs, engagements, template_items,
   │      audit_items (Findings), reports, client_portal_links, access_log
   ├─▶ Supabase Storage (RLS-scoped) — Tier B evidence documents
   ├─▶ Tier A check functions (WHOIS/DNS/SSL/CMS libraries or thin third-party APIs) —
   │      background job via Inngest, writes results into audit_items
   ├─▶ Report route (server-rendered HTML from the same Finding data) ─▶ Browserless
   │      (HTML → PDF) ─▶ PDF stored in Supabase Storage, `reports.pdf_url` set
   └─▶ Resend (invite emails, "report ready" notification)
```

## 5. Checklist engine — data model and design

**Config-driven templates, cloned into a per-engagement instance — not a drag-and-drop form
builder, and not a rigid fixed template either.** `spec.md` §3 already specifies this shape
("consultant may add engagement-specific custom items but cannot edit the shared template from
inside an engagement") — this document confirms it's the right cost/flexibility trade-off. A true
form builder (conditional logic, arbitrary field types, Typeform-style) is a multi-week feature on
its own and isn't what this workflow needs — DD checklists are structured and tiered, not
branching. Build the simple version; instrument which items get added/removed across the first ~20
real engagements to learn whether a real builder is ever justified.

**Core tables** (naming follows `spec.md` §3's domain model):

| Table | Purpose |
|---|---|
| `consultant_orgs` | Tenant root. Plan, brand kit, Stripe customer ref. |
| `org_members` | `user_id` (Supabase auth) × `org_id` × role. |
| `templates` / `template_items` | Product-owned, versioned. One row set for Restaurant/online-ordering in MVP. Tier, method (automated/manual), prompt, severity rules, order. Readable by all orgs, not writable by them. |
| `engagements` | One per deal. `org_id`, target business, deal stage, `template_id` + pinned `template_version`. |
| `audit_items` | The cloned/instantiated Finding: `engagement_id` × `template_item_id`, status, severity, finding note, blocked reason, who/when. |
| `evidence` | File attachments per `audit_item`, pointing into Supabase Storage. |
| `reports` | Versioned generated output per engagement: rating, override note, `pdf_url`, `generated_at`. |
| `client_portal_links` (Phase 3) | Scoped token, expiry, revocation, tied to one `report_id`. |
| `access_log` | Who viewed/exported/shared a report and when — a sellable feature per `spec.md` §8, not just an internal log. |

**RLS pattern:** every tenant-owned table scoped by `org_id` (directly, or via a join through
`engagements.org_id`). `templates`/`template_items` are the one exception (readable-by-all,
writable-by-none from the app). The magic-link portal path (Phase 3) should **not** rely on giving
the anon/public role direct RLS-scoped table access — route it through a dedicated server-side
handler using the service-role key that validates the token and returns only the narrow report
snapshot, so a link-forwarding leak exposes exactly what was published, not a query surface into
the underlying tables.

## 6. Report generation complexity

Realistic options, compared directly:

| Approach | Fidelity | Serverless fit | Cost | Verdict |
|---|---|---|---|---|
| `@react-pdf/renderer` | Medium — CSS-subset (flexbox only), manual page-break/header-footer handling | Excellent (pure JS, no browser) | $0 | Rejected: fights the "same data drives on-screen + PDF" principle since it can't reuse real HTML/Tailwind components; multi-page tables and traffic-light styling get fiddly. |
| Puppeteer + `@sparticuz/chromium` inside a Vercel function | High (real Chrome) | Fragile — trimmed chromium binary, bundle-size and cold-start sensitivity | $0 extra, but real engineering-time cost in packaging | Workable but avoidable risk for a small monthly fee elsewhere. |
| **Browserless.io (hosted headless Chrome)** | High (real Chrome, rendering the same HTML report route) | Clean — one API call from a normal Vercel function, well within the 800s duration limit | $25/mo at this volume | **Recommended.** Reuses on-screen components, no chromium packaging problem, swappable later behind a thin adapter interface (low platform lock-in — see §8). |
| Managed HTML→PDF API (e.g. DocRaptor) | High | Clean | Comparable, per-document pricing | Reasonable fallback if Browserless's specific rendering behavior doesn't hold up in the spike below. |

**Unresolved, flag rather than guess:** actual visual quality of a real multi-section, multi-page,
whitelabeled report (logo placement, page-break behavior around tables, font embedding — Browserless
runs Chromium in its own environment, so fonts available locally may not be available there unless
self-hosted/embedded) is unconfirmed. **Propose a one-day spike**: build one representative report
page and run it through the actual chosen pipeline before the checklist engine's UI work begins,
since the report is the thing being sold and a pipeline that doesn't hit "client-ready" cheaply
would change this document's cost estimate materially.

## 7. Effort — three honest scope tiers

Ranges, not points; confidence reflects the stated familiarity gap (RLS, headless-PDF pipeline).

### Tier 0 — Paid-pilot MVP (checklist engine + report generation, invite-only, minimal payment collection — this document's answer to "thinnest thing that takes money")

| Component | Days (range) | Confidence |
|---|---|---|
| Scaffolding, CI/CD, Vercel deploy, env config | 1–2 | High |
| Auth + multi-tenant data model + RLS policies (§5) | 5–7 | **Low** (stated unfamiliarity, and correctness here is safety-critical) |
| Checklist engine: single template, engagement/audit CRUD, item status + finding capture, Tier B upload + structured fields, Tier C attested-finding capture | 10–14 | Medium |
| Tier A automated checks (real WHOIS/DNS/SSL/CMS-fingerprint integration, not mocked) | 3–5 | Medium |
| Evidence/document upload (Supabase Storage) | 2–3 | High |
| Report generation (PDF pipeline, whitelabel, severity roll-up + override, disclaimer section) | 10–14 | **Low** (pipeline fidelity unconfirmed, §6) |
| Payment collection — Stripe Payment Link / manual invoice only | 1–2 | High |
| Admin provisioning (bare-minimum internal tool to create an org, since onboarding is white-glove) | 1–2 | High |
| Error handling, logging (Sentry) | 1–2 | High |
| Legal pages (ToS/privacy, adapted template — flag for real legal review before first non-partner paying customer, cost not counted here) | 1 | High |
| QA / visual-PDF-QA / bug buffer | 4–6 | Medium |
| **Total** | **40–58 days (~8–12 weeks)** | |

`roadmap.md` Phase 1 estimates 6–10 weeks for a similar (slightly broader, since it doesn't
separate out payment collection) scope — this document's independent bottom-up estimate runs
somewhat higher at the low end. The gap is concentrated in the two Low-confidence line items above;
worth re-costing after the report-pipeline spike (§6) resolves one of them.

### Tier 1 — Self-serve-ready v1 (+ real subscription billing, self-serve signup, 2–3 more templates, team seats)

| Component | Days (range) | Confidence |
|---|---|---|
| Stripe Subscriptions (webhooks, proration, dunning, cancellation) | 5–7 | Medium |
| Self-serve signup + onboarding wizard | 4–6 | High |
| 2–3 additional templates — dev build-out (excludes the domain research to know what each vertical's checklist should contain, which is real, separate effort) | 6–10 | Medium |
| Team/multi-seat support | 3–4 | Medium |
| Admin/support tooling upgrade (per-org impersonation, scoped and logged per `spec.md` §8) | 2–3 | Medium |
| **Additional total** | **20–30 days** | |
| **Running total (Tier 0 + 1)** | **60–88 days (~12–18 weeks)** | |

### Tier 2 — + Client-facing portal (magic-link, no buyer account, per §3's recommendation)

| Component | Days (range) | Confidence |
|---|---|---|
| Scoped signed-link report view (server-side token validation, service-role read path per §5) | 6–9 | Medium |
| Access/audit log surfaced to the consultant as a feature | 2–3 | High |
| Extra QA/hardening for the new external-facing, unauthenticated surface | 2–3 | Medium |
| **Additional total** | **10–15 days** | |
| **Running total (Tier 0 + 1 + 2, full user-facing scope from the original task framing)** | **70–103 days (~14–20 weeks)** | |

Note this is cheaper than a full authenticated client-account portal would have priced (would have
added 20–30+ days for a second user class' signup/session/password-reset flow) — the direct payoff
of `spec.md` §7's magic-link design choice.

## 8. Hard parts

Ranked by actual severity, not just engineering difficulty:

1. **Multi-tenant data isolation (RLS correctness) — the single hardest problem, and the one with
   catastrophic rather than merely embarrassing failure mode.** This product sits inside
   NDA-covered M&A deal flow; a cross-org data leak (one consulting firm seeing another's target
   company's contracts or findings) isn't a bug, it's the kind of incident that ends every
   customer relationship at once, not just the affected one — `spec.md` §8 names this as the
   product's core risk correctly. It's also foundational: every other table inherits its isolation
   model from decisions made here, so getting it wrong is a rewrite discovered late, not a patch.
   **De-risk:** write an RLS test suite (pgTAP or integration tests hitting Postgres directly under
   different auth contexts) that asserts cross-org queries return zero rows, before any UI is built
   on top of the schema — this needs to be a gate, not a code-review nicety, given the stated
   unfamiliarity with RLS specifically.

2. **Report/PDF generation quality.** "Client-ready" is a real but fuzzy bar, and headless-browser
   rendering is a known source of environment-specific bugs (fonts available in local dev but not
   in the Browserless runtime unless embedded; page-break behavior around tables; logo/image
   handling). Getting this wrong doesn't leak data, but it directly undermines the product's actual
   pitch ("a deliverable the consultant can hand over under their own name," `spec.md` §2).
   **De-risk:** the one-day spike in §6, run before the checklist engine's UI work, not after.

3. **Checklist flexibility vs. simplicity — a product-design risk more than a technical one.**
   Already correctly resolved in `spec.md` (clone-and-edit, not a form builder) — flagged here only
   because the wrong call in either direction is expensive: too rigid and real deals won't fit the
   template (churn), too flexible and MVP scope balloons into competing with general-purpose
   builder tools. **De-risk:** the plan already in place — instrument item additions/edits across
   the first ~20 real engagements before considering a builder.

Removed from this list on purpose: **live credential handling for Tier C** would have been the
hardest problem in the entire build (secrets vault, scoped credential proxying into third-party
admin panels, rotation, breach blast-radius) had `spec.md` §4 not explicitly ruled it out for v1.
That decision is the single biggest complexity-avoidance move in the whole spec and this document
endorses it without reservation — do not revisit it speculatively; only if a real design partner
makes it an explicit, named blocker.

## 9. Maintenance

**Estimate: 10–15 hours/month at 10–20 active consultant accounts**, not counting occasional
spikes around major dependency upgrades (Next.js major-version bumps, roughly every 12–18 months,
are a known multi-day event, not a routine update — budget separately when they land). Load at
this scale: dependency/security patches (Next.js, Supabase client, Stripe SDK, Browserless API
surface), a handful of support tickets ("why didn't my PDF generate," billing edge cases), backup
verification, and the kind of low-volume-but-nonzero data-deletion/retention requests `spec.md` §8
already commits to supporting. This is a real B2B product touching confidential deal documents and
money — it cannot go fully hands-off even at low account counts.

## 10. Platform risk

- **Supabase** (single vendor for auth + DB + storage): an outage or an adverse pricing change hits
  three subsystems at once. Partial mitigation: Postgres itself is portable (standard `pg_dump`/
  restore), and Supabase Auth's core (GoTrue) is open source — not full lock-in — but the RLS
  policy investment and any Storage-specific access-policy wiring would need real rework to migrate
  to Neon/RDS/self-hosted. Moderate risk, bounded cost.
- **Vercel**: function-duration and fluid-compute billing policy have changed multiple times
  recently (the 800s-max, 30-min-beta tiers cited in §4 are themselves evidence the policy is still
  moving) — moderate risk, but Next.js is portable to a plain Node server (Fly.io/Render) if needed,
  at a real but bounded migration cost.
- **Browserless / PDF vendor**: least sticky dependency by design — write the report-generation
  code behind a thin internal adapter interface so switching to DocRaptor or a self-hosted
  Puppeteer worker later is a contained change, not a rewrite.
- **Stripe**: standard, low risk, market-standard tooling with no realistic displacement risk in
  this build's timeframe.
- **Not an infra risk, but the more consequential one:** `idea.md`'s own demand evidence names
  DueDilio (200+ listed providers) and QoE firms as the buyer population — either building
  equivalent tooling in-house for their own provider network is a real, named competitive risk.
  That's a distribution/market risk, not a build risk, and already tracked as an open question in
  `spec.md` §12 — noted here only because it's the platform risk most likely to actually matter,
  more than any infra vendor listed above.

## 11. Reusable leverage

The multi-tenant Next.js + Supabase (Postgres/Auth/Storage/RLS) + Stripe + headless-PDF-adapter
scaffold this build produces — org/tenant model, an RLS test harness, a report-generation adapter
pattern, magic-link scoped-sharing pattern — is a directly reusable shape for essentially any
future "vertical B2B tool for a professional selling to an industry" idea, which is the dominant
shape of candidates in the sibling `webdevprofit` workspace. Worth writing up as a playbook in that
workspace's `docs/playbooks/` once this build is done, per that workspace's own operating manual.

---

## Sources checked this session

- [Vercel — Configuring Maximum Duration for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/duration) (fetched 2026-09-11) — Hobby 300s max; Pro/Enterprise 300s default, 800s max (GA), 1800s extended (beta).
- [Clerk — Pricing](https://clerk.com/pricing) (fetched 2026-09-11) — free tier 100 orgs/20 members; B2B add-on $100/mo ($85/mo annual) for unlimited members/SSO.
- [Supabase — Pricing](https://supabase.com/pricing) (fetched 2026-09-11) — Free 500MB DB/1GB storage; Pro $25/mo, 8GB DB + 100GB storage included.
- [Neon — Pricing](https://neon.com/pricing) (fetched 2026-09-11) — usage-based compute/storage; auth and object storage are newer, separately-priced/beta services, not as tightly bundled as Supabase's.
- [Browserless.io — Pricing](https://www.browserless.io/pricing) (fetched 2026-09-11) — free tier 1,000 units/mo; Prototyping $25/mo for 20,000 units/mo.
- `docs/idea.md`, `docs/spec.md`, `docs/roadmap.md` (this repo) — existing product decisions this document costs and, in one case (portal shape), explicitly validates.
- `~/dev/webdevprofit/research/bizbuysell-main-street-tech-audit/build.md` — source three-tier methodology and hours-per-audit research this product's Tier A/B/C structure derives from.
