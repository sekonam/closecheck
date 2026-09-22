# CloseCheck — Roadmap

Status: **v0.1 draft**, sequenced against [`spec.md`](spec.md). Phases are gated by exit criteria,
not calendar dates — a phase ends when its criteria are met, not when a fixed number of weeks has
passed. Rough duration estimates are included for planning only.

Each phase lists: **Goal**, **Deliverables**, **Exit criteria** (go/no-go into the next phase), and
**Primary risk**.

**Status note (2026-09-21): build state and validation state have diverged.** The deliverables of
Phases 1–3 are substantially built (core loop, four templates, team plans, self-serve signup, pricing
page, client portal — see git history), per explicit user direction to build ahead of the evidence
gates. The *evidence* side has not moved: no design partners recruited (Phase 0), no real-deal audit
completed (Phase 1 exit), no paying customer (Phase 2 exit). Validation state is effectively
pre-Phase 0 while build state is through Phase 3. The exit criteria below therefore remain the honest
go/no-go signals — they gate *validation and GTM*, not code existing. Two additions follow from the
2026-09-21 research pass (`docs/research/profitability.md`, `competitors-2026-09.md`,
`promotion.md`): a new **Phase 2.5 (Revenue readiness)** closing the gap between built features and
the ability to take money and measure outcomes, and a **competitive-window constraint** — the
gap-thesis window is now judged 12–24 months (`competitors-2026-09.md` §3), and since AI report
generation has commoditized the automated-checks-to-PDF layer, sequencing should favor the durable
moat (Tier B/C evidence capture, business-type templates, whitelabel workflow) over further Tier A
expansion when the two compete. The promotion/GTM track (`docs/research/promotion.md`'s 90-day
sequence) runs in parallel with Phase 2.5 and is owned by `docs/releases.md` §4, not this file.

## Phase 0 — Design partner discovery (no product yet)

**Goal:** confirm the reframe in `idea.md` actually converts to willingness-to-pay before writing a
line of application code beyond a throwaway prototype.

**Deliverables:**
- 10–15 discovery calls split across **two distinct populations**, not treated as one list: existing
  DueDilio-listed technology-DD providers (a tool-switch pitch), and QoE generalists/independent IT
  consultants who don't currently offer technology diligence (a new-service-line pitch) — this split
  matters because `docs/research/market.md` §3 and `docs/research/pricing.md` §2 found the
  technology-DD-specialist subset of DueDilio's 200+ providers is likely well under 100, so hitting
  early revenue targets probably requires the second population, not just the first.
- On pricing specifically, run the head-to-head test `docs/research/pricing.md` §7 specifies: pitch
  both a subscription and a per-audit option side by side and record which one each call picks and
  where price hesitation kicks in — this is the single input the hybrid pricing model in `spec.md` §9
  most needs validated before any billing logic is built.
- A walking-deck or clickable prototype of one Report output (can be hand-built/mocked, not the real
  product) shown in those calls to react to, not just described.
- 2–3 committed design partners willing to run a real Audit on a real live deal in Phase 1, ideally
  for free or discounted in exchange for feedback.
- Validated or corrected: the one-template MVP choice (Restaurant/online-ordering, per `spec.md` §5),
  the hybrid base-plus-per-audit pricing direction (`spec.md` §9), and whether Tier C's "no credential
  handling" decision (`spec.md` §4) is actually a blocker for anyone real.

**Exit criteria:** at least 2 design partners committed with a real upcoming deal to test on, and no
discovery call surfaced a reframe-invalidating objection (e.g., "I'd never trust a third-party tool
with this regardless of credential handling").

**Primary risk:** the same distribution problem that killed the original buyer-facing framing
resurfaces in a different shape — consultants may be just as referral-network-gated and cold-outreach-
resistant as buyers were. This phase exists specifically to find out before Phase 1 is funded.

**Estimate:** 2–4 weeks of outreach and calls, run in parallel with early prototype work.

## Phase 1 — MVP: one template, core loop, PDF report

**Goal:** a design partner can run a complete Restaurant/online-ordering Audit on a real deal, tier by
tier, and export a whitelabeled PDF report they actually send to a buyer.

**Status (2026-09-21):** deliverables built (see top status note). The exit criterion is untouched
and unmet — no design partner has run a real-deal audit; recruiting them is the Phase 0 work that
still gates this phase's *completion*, build state notwithstanding.

**Deliverables:**
- Consultant Org + Engagement + Audit data model (`spec.md` §3), single-tenant-safe from day one
  (`spec.md` §8's isolation rule applies even with one paying customer).
- Restaurant/online-ordering Template (`spec.md` §5), full tier structure (`spec.md` §4).
- Tier A automated checks (WHOIS/DNS/SSL/CMS fingerprint) wired to real data sources, not mocked.
- Tier B document upload + structured-field capture for contract terms.
- Tier C consultant-attested finding capture (no credential handling, per `spec.md` §4).
- Report generation: traffic-light executive summary, tiered detail, whitelabel cover/footer, PDF
  export (`spec.md` §6).
- Manual onboarding (white-glove, not self-serve signup) for the 2–3 design partners.

**Exit criteria:** at least one design partner completes a full real-deal Audit end-to-end and sends
the generated PDF to an actual buyer/advisory team, unprompted rework of the report in another tool.

**Primary risk:** a bottom-up build estimate (`docs/research/build.md` §1, §7) puts the actual
time sinks at **multi-tenant row-level security done correctly** (not just "works for one org" —
load-bearing given `spec.md` §8's reputational-risk framing) and **getting the whitelabeled PDF
pipeline to a genuinely client-ready visual bar** — both rated low-confidence estimates in that
research specifically because of stated unfamiliarity with RLS and headless-PDF rendering. Tier B's
document-to-structured-field variability (every seller hands over contracts differently) is a real,
secondary risk but not the dominant one per that estimate.

**Estimate:** 8–12 weeks (`docs/research/build.md` §1 and §7 give a bottom-up 40–58 developer-days
for a solo developer, revising the original 6–10 week guess upward).

## Phase 2 — Template library expansion + team plans

**Goal:** broaden beyond the single validated template and beyond single-seat usage, based on actual
design-partner deal flow (which business types they're really encountering), not the original
four-template guess.

**Status (2026-09-21):** deliverables built (all three additional templates, team plans, self-serve
signup, pricing page). The exit criterion is not just unmet but currently *unmeasurable*: the pricing
page is display-only — no billing exists anywhere in the codebase — so "self-serve signups convert to
paid" cannot happen until Phase 2.5 below lands. Note the template-proliferation risk below
materialized in the way it predicted: all four templates now exist without design-partner deal-flow
evidence for their sequencing.

**Deliverables:**
- Salon/booking and Franchise templates (`spec.md` §5) — sequenced by whichever design partners'
  actual deal flow demands first, not a fixed order.
- General e-commerce template, if still evidenced by then.
- Team-tier multi-seat support (shared Engagements across a firm's consultants).
- Self-serve signup and the pricing page (`spec.md` §9) — this is the first point pricing becomes
  real rather than a discovery-call conversation.
- Template versioning enforcement (`spec.md` §5) exercised for real as templates get their first
  post-launch revisions.

**Exit criteria:** self-serve signups convert to paid at a rate that doesn't depend on white-glove
onboarding; at least one firm (not solo consultant) is on a Team plan with multiple active seats.

**Primary risk:** template proliferation without validated demand — building a template nobody in the
actual design-partner pipeline needs yet, re-creating the "guessed feature list" risk `idea.md` was
explicit about avoiding.

**Estimate:** 6–8 weeks.

## Phase 2.5 — Revenue readiness (inserted 2026-09-21)

**Goal:** close the gap between built features and a business — the product can take money, deliver
its own emails, and measure the success metrics its evidence gates depend on. Inserted here because
Phase 2's exit criterion (self-serve → paid conversion) is impossible to meet, or even measure,
without this work; sourced from the 2026-09-21 implementation-gap audit and
`docs/research/profitability.md`.

**Status (2026-09-22):** all five deliverables are **built** — Stripe billing (checkout, portal,
signature-verified webhook, audit-credit ledger with batched overage), transactional email (Resend
with a LOGGED dev fallback), success-metric + error instrumentation with a founder report script,
the RDAP-first WHOIS migration, and a guided first-audit onboarding flow. Verified against a fresh
local Postgres (full RLS/role/versioning verify suite passing on a deliberately non-UTC cluster) and
a live browser end-to-end run. The **exit criterion remains unmet**: billing enforcement ships dark
(`BILLING_ENFORCEMENT=false`) and no real Stripe/Resend account is wired yet, so no production charge
or refund has been processed — that needs the account credentials only the founder can provision
(blocked on that, not on code). Per explicit user direction (2026-09-22) to build the roadmap out
ahead of its evidence gates, same override recorded for Phases 3 and 4.

**Deliverables:**
- **Stripe billing implementing `spec.md` §9 as revised 2026-09-21.** Annual-credits plan as the
  lead offer (~17% discount, bundled audit credits) with monthly second — annual-default is the
  best-evidenced churn lever for a low-frequency buyer (`profitability.md` §6 lever 1). Per-audit
  overage priced in the $99–149 test band and **batched into a monthly rollup invoice**, not charged
  per audit (lever 4 — avoids Stripe fixed-fee waste and "charged again" moments). Prices must stay
  config-changeable, since every number is still awaiting the Phase 0 head-to-head test.
- **Transactional email** (team invites, portal link delivery, receipts) — invites and portal links
  are currently copy-paste URLs with no delivery mechanism; a hard self-serve conversion blocker.
- **Success-metric instrumentation + error tracking.** `spec.md` §11's activation, second-audit
  retention proxy, and report-usage metrics are not instrumented anywhere, so every evidence gate in
  this roadmap is currently unmeasurable in-product. Basic error tracking ships with it.
- **Tier A WHOIS → RDAP migration.** Verified 2026-09-21: `src/lib/checks/whois.ts` does raw port-43
  WHOIS with IANA referral — the legacy path ICANN sunset in January 2025, with hundreds of gTLDs
  already off port 43 (`profitability.md` §3, `spec.md` §10). Migrate to RDAP before Tier A
  reliability becomes a first-impression/churn problem.
- **White-glove first-audit onboarding flow.** ~43% of SMB SaaS churn lands in the first quarter
  (`profitability.md` §2), so retention work here means a guided, founder-assisted first audit — not
  steady-state support tooling.

**Exit criteria:** a stranger can sign up, pay (annual or monthly), run a full audit, and receive
every system email with zero founder intervention; a real production charge and a real refund have
each been processed end-to-end; the §11 metrics for that journey are visible somewhere the founder
actually checks.

**Primary risk:** mistaking "billing exists" for "pricing validated." Every price this phase
implements is an untested hypothesis until the Phase 0 head-to-head test runs — the specific
mitigation is config-level price changeability and resisting any public GTM push that would freeze
the numbers before evidence arrives. This is the same build-ahead-of-evidence divergence recorded in
the top status note, now applied to money.

**Estimate:** 2–4 weeks (billing 1–2 weeks using Stripe-hosted checkout/portal surfaces; email,
instrumentation, and RDAP migration a few days each).

## Phase 3 — Client-facing portal + distribution partnership

**Goal:** close the loop on `idea.md`'s open distribution question and ship the portal only once
there's a validated reason to (per `spec.md` §7).

**Status update (2026-09-18):** the Client Portal Link deliverable below was built ahead of the
Phase 1/2 evidence this phase calls for, per explicit user direction to build through Phase 3
regardless of the normal evidence gate. The distribution-channel decision remains unresolved — it's a
business/strategy call, not something buildable from this codebase, and stays open per the reasoning
below.

**Deliverables:**
- Magic-link, no-account Client Portal Link (`spec.md` §7) — built only if Phase 1/2 design partners
  or their buyers explicitly asked for it; otherwise this deliverable is replaced by whatever gap
  Phase 1/2 actually surfaced.
- A resolved distribution channel decision (`spec.md` §12): pursue a DueDilio-style marketplace
  listing/partnership vs. continued direct outreach vs. some other channel — decided from Phase 0–2
  evidence about where design partners actually came from, not guessed in advance.
- Audit logging / access history surfaced to consultants as a feature (`spec.md` §8), now that
  external parties (buyers) are viewing reports directly.

**Exit criteria:** the chosen distribution channel is producing inbound leads without founder-driven
manual outreach for every single one.

**Primary risk:** building the portal before the demand signal is real — this phase's deliverables are
explicitly conditional, not committed, until Phase 1/2 evidence says otherwise.

**Estimate:** 8–12 weeks, highly dependent on which distribution path is chosen.

## Phase 4 — Depth: automation, integrations, API

**Goal:** deepen the product for firms who've adopted it as core infrastructure, once there are enough
paying firms for this to be worth building.

**Status update (2026-09-21):** a first slice of this phase is being built ahead of the "re-plan
from real usage first" gate below, per explicit user direction to proceed — the same kind of override
recorded for Phase 3's Client Portal. The gate's reasoning stands and is preserved: with no paying
firms yet, none of this scope is evidence-backed. The mitigation, per `spec.md` §13, is that the
committed slice is deliberately primitives-only — more of the existing class of Tier A check, a
read-only API, and webhooks — with everything vendor-specific or speculative still held behind real
evidence.

**Deliverables — committed slice (per `spec.md` §13, built under the override above):**
- Three new Tier A automated checks, same public-information-only class as the existing four:
  SPF/DKIM/DMARC email-authentication posture, MX/mail-provider fingerprint, and HTTPS hygiene
  (HTTP→HTTPS redirect, HSTS). Adding them to shipped templates is a template-version event
  (`spec.md` §5, `releases.md` §3).
- Org-scoped **read-only** API: per-org revocable keys (hashed at rest, last-used surfaced), RLS-
  enforced like the interactive app. No write API.
- Signed webhooks (`audit.completed`, `report.generated`) as the integration primitive — identifiers
  and status only in payloads, never findings content (`spec.md` §8).

**Deliverables — still indicative, not committed (unchanged gate: re-evaluate against real usage):**
- Named CRM/deal-tracking connectors on top of the webhook/API primitive — deferred until a paying
  firm names the tool they'd actually connect (`spec.md` §12, §13.3).
- Further Tier A automation requiring paid third-party APIs (vulnerability databases, trademark
  search — `spec.md` §12).
- SOC 2 posture work — still gated on a firm's client contract or partner integration making it a
  sales blocker (`spec.md` §8), not built speculatively.

**Exit criteria:** N/A — this phase remains deliberately open-ended beyond the committed slice above;
re-plan the indicative items explicitly from real-usage evidence rather than executing them as
written.

**Primary risk:** scope creep into a general-purpose diligence platform, diluting the specific,
evidenced wedge (`idea.md`'s tech-diligence gap in the $200k–2M band) that made this viable in the
first place.

**Sequencing note (2026-09-21, competitive window):** `docs/research/competitors-2026-09.md` §3
judges the competitive gap durable for 12–24 months and finds AI report generation has commoditized
the automated-checks-to-PDF layer — Tier A is the wedge, not the moat. Consequence for this phase:
beyond the already-built committed slice, further Tier A expansion (the paid-API items above) ranks
*below* deepening the durable moat — Tier B/C evidence capture, template quality, and whitelabel/
portal polish — whenever the two compete for the same weeks. This tightens, not replaces, the
existing "re-plan from real usage" gate.
