# Blocked on the founder

Work that is **finished in code** but cannot be completed by anyone without account credentials,
a real counterparty, or a business decision that isn't derivable from this repo.

This file exists so that "blocked" never silently becomes "done". Nothing here may be marked
complete in `docs/roadmap.md` or checked off in `docs/releases.md` §5 on the strength of code
existing — several of these gates are specifically worded to refuse that (`releases.md` §5:
"demonstrated by an actual cross-org request test, not code inspection alone").

Last reviewed: 2026-09-22.

---

## 1. Live-mode Stripe — the production charge and refund

**Gate:** `roadmap.md` Phase 2.5 exit criteria; `releases.md` §5 "Billing exists and has taken a real
payment end-to-end".

**State.** Everything except live keys is done and proven. `tests/integration/stripe-billing-e2e.itest.ts`
drives real Stripe **test-mode** objects: real customers carrying server-set `metadata.orgId`, real
subscriptions (including the two-line Team shape), real signed webhook events delivered to the real
route with real signature verification, and a real $129 PaymentIntent confirmed and then refunded to
zero. The chain works.

**What only the founder can do:**
- Provision a **live-mode** Stripe account (business details, bank account, identity verification).
- Create the five live-mode prices and set `STRIPE_PRICE_*` on the production service. The test-mode
  amounts currently configured are Solo $35/mo + $348/yr and per-additional-seat $25/mo + $249/yr —
  see `src/lib/billing/config.ts` for why the Team vars are per-seat, not per-plan.
- Register the production webhook endpoint (`https://<host>/api/stripe/webhook`) and set
  `STRIPE_WEBHOOK_SECRET` from it. **This needs a deployed public URL first — see item 3.**
- Run one real charge and one real refund, in live mode, and confirm the receipt email arrives.

**Do not** flip `BILLING_ENFORCEMENT=true` before that. Enforcement is what starts blocking audits
and marking overages billable; it ships dark deliberately (`releases.md` §5).

---

## 2. Resend — domain verification

**Gate:** `roadmap.md` Phase 2.5 exit criterion, "receive every system email".

**State.** `RESEND_API_KEY` is set and is a real, send-restricted key. Sending is implemented with a
LOGGED fallback when unconfigured, so nothing crashes without it.

**What only the founder can do:** verify a sending domain in Resend (DNS records on a domain you
control) and set `EMAIL_FROM` to an address on it. Until then Resend's sandbox restriction means mail
only delivers to the account owner's own address — already noted in `deployment.md`. Team invites and
portal links to a *stranger's* address will not arrive, which is exactly the Phase 2.5 criterion, so
this is a real blocker and not a formality.

---

## 3. Production deployment

**State.** `render.yaml`, `Dockerfile`, migrations, role-password rotation and the full runbook in
`deployment.md` are ready. No deployment exists.

**What only the founder can do:** create the hosting account and enter billing details
(`deployment.md` says plainly that this should not be automated on anyone's behalf, and that stands).
Everything after the first "Apply Blueprint" click is scripted.

**Blocks:** item 1's webhook endpoint, item 2's end-to-end email test, and any GTM step that needs a
URL to point at.

---

## 4. Design partners — the evidence gates

**Gate:** `roadmap.md` Phase 0 exit, Phase 1 exit, Phase 2 exit.

**State.** Unmoved. Build state runs through Phase 4's committed slice; validation state is still
pre-Phase 0. This is the divergence the roadmap's top status note already records, restated here so
it is not mistaken for a code task.

**What only the founder can do:** the 10–15 discovery calls across both populations, the
subscription-vs-per-audit head-to-head price test (`research/pricing.md` §7), and recruiting 2–3
partners with a real live deal. Until that happens **every price in `spec.md` §9 is an untested
hypothesis** — which is why they are all env-driven and changeable without a code change.

Assets that already exist for this: `docs/gtm/` (prospect list, outreach kit), and the
free-sample-audit offer.

---

## 5. Distribution channel decision

**Gate:** `spec.md` §12; `releases.md` §5 "before any GTM push toward a marketplace partnership".

**What only the founder can do:** decide between a DueDilio-style marketplace listing, continued
direct outreach, and the ranked alternatives in `research/promotion.md`. The gate explicitly requires
this be decided *from evidence about where design partners actually came from*, which means item 4
comes first. Not a code task and not one to default into.

---

## 6. Phase 4 customer enablement

**Gate:** `releases.md` §5, "before enabling the Phase 4 depth set for customers".

**State.** Two of the three gate lines are now closed with real evidence rather than inspection:

- API keys org-scoped at the RLS layer — `tests/integration/api-tenant-isolation.itest.ts`, 17
  assertions over real HTTP against a running server plus direct database-layer proof.
- Webhook payloads identifiers-and-status-only — `tests/integration/webhook-payload.itest.ts`,
  asserted against the intercepted outbound body with an allowlist, not the intent.

**What only the founder can do:** the third line — "at least one paying firm has asked for
programmatic access, or the feature ships dark until one does". There is no paying firm, so the
feature stays dark. That is the gate working, not a gap.

---

## 7. The deferred Phase 4 items — deliberately not built

`spec.md` §13.4 and `roadmap.md` Phase 4 list several things as "indicative, not committed". They
were reconsidered on 2026-09-22 under an explicit instruction to build the deferred set, and the
outcome was to build none of them. Recording the reasoning here rather than leaving them looking
merely forgotten:

- **Named CRM/deal-tracking connectors.** The primitive they would sit on — signed webhooks and the
  read-only API — is built, tested and documented (`docs/api.md`). Picking a named CRM now is
  exactly the guessed-feature-list mistake `idea.md` is explicit about avoiding, and §13.3 already
  decided that the connector waits for a firm to name the tool. Nothing about the last two days
  changes that; no firm exists to name one.

- **Tier A checks against paid third-party APIs** (vulnerability databases, trademark search). Two
  separate blockers, and only one is money. The first is that they need paid accounts nobody can
  provision but the founder. The second is the sequencing constraint from
  `research/competitors-2026-09.md` §3, which `roadmap.md` Phase 4 already encodes: AI report
  generation has commoditized the automated-checks-to-PDF layer, so **Tier A is the wedge, not the
  moat**, and further Tier A expansion ranks *below* Tier B/C evidence depth and template quality
  whenever they compete for the same time. They competed, and the moat work won — see the template
  v3 and evidence-capture work landed the same day.

- **Whitelabel as a paid add-on tier** (`spec.md` §12). This is a segmentation decision, and §12
  says to make it "once real customers exist to segment". There are none. Implementing the billing
  for a tier whose existence is unresolved would also freeze a price before the Phase 0 head-to-head
  test, which is the specific failure mode `roadmap.md` Phase 2.5 names as its primary risk.

- **SOC 2** — see below; unchanged.

The honest summary: the Phase 4 scope that could be built without new evidence or a paid account
*was* built, and is covered by tests and documentation. What remains is gated on things code cannot
supply.

## 8. SOC 2 posture

**Gate:** `spec.md` §8, §13.4 — explicitly gated on a real sales blocker (a firm's client contract or
a partner requirement), not built speculatively. Listed here only so it is visibly *deferred by
decision* rather than forgotten.

---

## How to use this file

When one of these unblocks, do the work, then update `roadmap.md` / `releases.md` **and** delete the
item here. An item that is done but still listed is as misleading as a gate ticked without evidence.
