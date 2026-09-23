# Blocked on the founder

Work that is **finished in code** but cannot be completed by anyone without account credentials,
a real counterparty, or a business decision that isn't derivable from this repo.

This file exists so that "blocked" never silently becomes "done". Nothing here may be marked
complete in `docs/roadmap.md` or checked off in `docs/releases.md` §5 on the strength of code
existing — several of these gates are specifically worded to refuse that (`releases.md` §5:
"demonstrated by an actual cross-org request test, not code inspection alone").

Last reviewed: 2026-09-23.

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
  `STRIPE_WEBHOOK_SECRET` from it. **This needs a deployed public URL first — see item 3
  ("Production deployment").**
- Run one real charge and one real refund, in live mode, and confirm the receipt email arrives.

**One thing to check in the Stripe dashboard while you are there:** the customer billing portal's
configuration should NOT allow subscription plan switching. The app records which plan an org bought
in the subscription's metadata at checkout, and a plan changed through the portal does not rewrite
it. A seat line on the subscription still overrides stale metadata (`resolveSubscriptionPlan` in
`src/lib/billing/config.ts`), so a Team plan is always recognised correctly — but a Team-to-Solo
downgrade made in the portal would leave the org recorded as Team. Plan changes are meant to go
through the app's own checkout. The portal is for payment methods and invoices.

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

**Blocks:** item 1's webhook endpoint ("Live-mode Stripe"), item 2's end-to-end email test
("Resend"), and any GTM step that needs a URL to point at.

---

## 4. Object storage — the R2 bucket and its credentials

**The provider decision is made: Cloudflare R2.** What is left is a bucket and a credential. The
code needed one change to suit it, already landed — see "what R2 changed" below.

**State.** Built and tested, not yet run against a real bucket. `src/lib/storage/objectStore.ts`
has two backends: local disk (the default, unchanged, needs no configuration) and an S3-compatible
one that activates the moment `STORAGE_S3_BUCKET` is set. Written against the S3 protocol rather
than a provider, so R2, AWS S3, Backblaze B2, DigitalOcean Spaces and MinIO all work — the R2
choice is reversible.

**This is a different kind of blocker from the rest of this file, and worth separating.** Everything
else here waits on evidence you have to go and find — a design partner, a paying customer. This
waits only on a credential now.

**What only you can do**, concretely:

1. In the Cloudflare dashboard, **create an R2 bucket**. Note your account ID.
2. **R2 → Manage API Tokens → Create token.** Permission **"Object Read & Write"**, scoped to that
   one bucket — not an Admin token, which is account-wide and can create and delete buckets. The
   app only ever reads, writes and deletes objects.
3. Copy the **Access Key ID** and **Secret Access Key** it shows you. The secret is shown once and
   cannot be retrieved afterwards; a lost one is replaced by issuing a new token.
4. Set on the web service:
   ```
   STORAGE_S3_BUCKET=<bucket name>
   STORAGE_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
   STORAGE_S3_REGION=auto
   STORAGE_S3_ACCESS_KEY_ID=<access key id>
   STORAGE_S3_SECRET_ACCESS_KEY=<secret access key>
   ```
   Leave `STORAGE_S3_SSE` unset, and `STORAGE_S3_FORCE_PATH_STYLE` unset — R2 needs neither.
   An EU-jurisdiction bucket uses `https://<account id>.eu.r2.cloudflarestorage.com` instead.
5. Run `npm run verify:deployment`.

Step 5 is what turns this from configured into proven, and it checks the thing most likely to be
wrong: it **deletes** the object it wrote, so a token issued with read and write but not delete
fails there rather than silently, months later, on the first retention purge that cannot remove a
seller's contract it has already dropped the database row for.

**What R2 changed in the code** (done, 2026-09-23, commit a9c9e4e): the backend used to send
`x-amz-server-side-encryption: AES256` on every write. R2 does not implement that header and
refuses the request, so the first upload would have failed. It is now off by default, which costs
nothing: R2 encrypts every object at rest with AES-256-GCM unconditionally, and AWS S3 has done the
same automatically since 2023-01-05. See `docs/security-posture.md` §4 for the accurate statement
of what that does and does not buy.

Once step 5 is green, do a second pass **through the product**, because the script exercises the
storage seam and not the application paths that use it: upload a document to an audit, download it
back, set that engagement to a terminal stage with a past purge date, and run
`npm run db:purge-expired-documents -- --engagement=<id>`. That covers write, read and delete
through the real callers, which is the whole surface — and it is what lets the "not yet exercised
against a real endpoint" caveat come out of `s3.ts`, `.env.example`, the runbook, **and
`docs/security-posture.md` §4**.

That last one is the one to not forget. The other three are internal; the posture document is what
gets sent to a firm's security reviewer. A caveat left standing there after it stopped being true
understates the product to the one audience reading it for accuracy — and an inaccuracy found in
that document costs credibility for every other claim in it, including the ones doing real work.

**Why it matters before a design partner, not after.** Local-on-a-mounted-volume is a supported
production configuration and the app says so at boot — but it gives no encryption at rest beyond
whatever the volume provides, and no redundancy: the volume is a single copy. A design partner
running a real audit means real seller contracts and merchant statements landing on it. That is the
largest remaining item in `docs/security-posture.md`, and it is the one gap on this list that a
firm's own security reviewer would ask about.

## 5. Design partners — the evidence gates

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

## 6. Distribution channel decision

**Gate:** `spec.md` §12; `releases.md` §5 "before any GTM push toward a marketplace partnership".

**What only the founder can do:** decide between a DueDilio-style marketplace listing, continued
direct outreach, and the ranked alternatives in `research/promotion.md`. The gate explicitly requires
this be decided *from evidence about where design partners actually came from*, which means item 5
("Design partners") comes first. It said item 4 until 2026-09-23, which was correct until object
storage was inserted above it and moved design partners down by one — hence the titles alongside
the numbers here and below. Not a code task and not one to default into.

---

## 7. Phase 4 customer enablement

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

## 8. The deferred Phase 4 items — deliberately not built

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

## 9. Read the report disclaimer and decide whether it says what you want

**Gate:** none — this is not blocking anything. It is here because it is the one piece of content
in the product that carries your consultants' professional exposure, and it was last edited by
engineering correcting a statement that had become false (`releases.md` §3, 2026-09-22).

Correcting it was right: it claimed Tier C was the only non-automated part, which invited a buyer's
counsel to read everything else as verified, and template v6 established that most Tier A checks
cannot reach the verdict their rubric describes. But "no longer false" is a lower bar than "the
language this firm wants to stand behind", and the second is yours, not ours.

The current text is a single paragraph in `src/lib/reports/disclaimer.ts`. Worth five minutes, and
worth a lawyer's eye before the first report reaches a real buyer's advisory team rather than after.

Note the cost curve: changing it clears every firm's acknowledgement and blocks report generation
until each owner re-acknowledges. Today that is one development org. After the first paying
customers it is a coordinated interruption for all of them — so this is cheapest to settle now.

## 10. SOC 2 posture

**Gate:** `spec.md` §8, §13.4 — explicitly gated on a real sales blocker (a firm's client contract or
a partner requirement), not built speculatively. Listed here only so it is visibly *deferred by
decision* rather than forgotten.

---

## How to use this file

When one of these unblocks, do the work, then update `roadmap.md` / `releases.md` **and** delete the
item here. An item that is done but still listed is as misleading as a gate ticked without evidence.
