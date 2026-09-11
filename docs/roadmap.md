# CloseCheck — Roadmap

Status: **v0.1 draft**, sequenced against [`spec.md`](spec.md). Phases are gated by exit criteria,
not calendar dates — a phase ends when its criteria are met, not when a fixed number of weeks has
passed. Rough duration estimates are included for planning only.

Each phase lists: **Goal**, **Deliverables**, **Exit criteria** (go/no-go into the next phase), and
**Primary risk**.

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

## Phase 3 — Client-facing portal + distribution partnership

**Goal:** close the loop on `idea.md`'s open distribution question and ship the portal only once
there's a validated reason to (per `spec.md` §7).

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

**Deliverables (indicative, not committed — re-evaluate against real usage before starting):**
- More Tier A checks automated (reduce manual items in the base checklist).
- CRM/workflow integrations (e.g. a firm's existing deal-tracking tool).
- API access for firms wanting to embed Audit data into their own tooling.
- SOC 2 posture work, if a firm's client contract or a partner integration makes it a blocker
  (`spec.md` §8).

**Exit criteria:** N/A — this phase is deliberately open-ended; re-plan it explicitly from Phase 3
evidence rather than executing this list as written.

**Primary risk:** scope creep into a general-purpose diligence platform, diluting the specific,
evidenced wedge (`idea.md`'s tech-diligence gap in the $200k–2M band) that made this viable in the
first place.
