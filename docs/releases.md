# CloseCheck — Release Plan

Status: **v0.1 draft**. Defines how work in [`roadmap.md`](roadmap.md) actually ships, to whom, and
in what order — separate from the roadmap's product sequencing.

## 1. Versioning scheme

Product versions track roadmap phases, not every deploy:

| Version | Meaning |
|---|---|
| `v0.x` | Pre-launch and private beta — Phase 0 discovery artifacts through Phase 1 design-partner usage. No public pricing, no self-serve signup. |
| `v1.0` | First self-serve-capable release — end of Phase 2 (template expansion + team plans + pricing page) **plus Phase 2.5 (revenue readiness — billing, transactional email, metric instrumentation; `roadmap.md`, inserted 2026-09-21)**. This is "GA" for the purposes of public announcement. |
| `v1.x` | Incremental Phase 2/3/4 additions (new templates, portal, and the Phase 4 depth set — expanded Tier A checks, read-only API, webhooks per `spec.md` §13) between major milestones. |
| `v2.0` | Reserved for the first release that materially changes the core loop (e.g., Tier C credential handling, if Phase 3/4 evidence ever justifies it) — not for routine feature additions. The Phase 4 read-only API does **not** trigger v2.0: it exposes the existing loop's data, it doesn't change the loop. |

The web app itself deploys continuously (no user-facing version number on every deploy); the `vX.Y`
labels above are for customer-facing changelog and GTM communication, aligned to roadmap phase
boundaries.

## 2. Release channels

| Channel | Who | Gate to enter |
|---|---|---|
| **Private beta** | The 2–3 design partners from Phase 0 | Manual selection; white-glove onboarding |
| **Public beta** | Anyone who signs up once self-serve exists | Opens at start of Phase 2 **and** §5's public-beta gate checklist passes (incl. billing + metric instrumentation) |
| **GA (`v1.0`)** | Public, with pricing live | Phase 2 exit criteria met (`roadmap.md`) — which presuppose §5's public-beta gates |

No separate "alpha" channel — Phase 0's prototype is explicitly not a real release (it's a
walking-deck/mock, per `roadmap.md` Phase 0), so there's nothing to version there.

## 3. Release cadence

- **Private beta (Phase 1):** ship to design partners as soon as each tier's workflow is usable, even
  incrementally (e.g., Tier A automated checks before Tier B upload is done) — the point of a small
  private cohort is that this is safe. Communicate changes directly, not via a changelog.
- **Public beta / GA onward (Phase 2+):** batch customer-visible changes into a periodic (e.g.
  monthly) changelog rather than announcing every deploy — consultants are not power users checking a
  changelog daily, and constant noise undercuts the "stable, repeatable tool" positioning from
  `spec.md` §2.
- **Template changes** always ship as a new Template version (`spec.md` §5), never an in-place edit to
  a template version already in use — this is a release-process rule, not just a data-model rule,
  because it's the one kind of change that can silently invalidate in-flight paying customers' work.
- **Pending template-version event (Phase 4, `spec.md` §13.1):** the three new Tier A automated
  checks (SPF/DKIM/DMARC posture, MX/mail-provider fingerprint, HTTPS hygiene) are added to each
  shipped template as a **new version of that template**, per the rule above — in-flight Audits stay
  pinned to the version they started on and never gain the new items mid-engagement. One
  customer-facing changelog entry covers the batch across all templates, not one entry per template.

## 4. Go-to-market plan (tied to phases)

GTM decisions live here, not in `spec.md`, because they're about *when and how to reach the market*,
not what the product is.

**Channel update (2026-09-21, `docs/research/promotion.md`):** a second research pass priced and
ranked the concrete promotion channels. Nothing in the 2026-09-11 correction below is overturned —
founder-led outreach with the free-Tier-A-audit hook stays the primary motion — but three things
changed and one is superseded:

1. **List-building is hours, not weeks.** The SMB-focused QoE segment self-promotes publicly
   (Guardian Due Diligence, Rapid Diligence, Centurica, Bedrock QoE, et al.), and third-party
   comparison guides ("18 Firms Ranked by Price & Sector" and similar) are pre-built prospect
   directories — a 60–100-firm named list is a first-week task, not the multi-week
   association-mining exercise budgeted below.
2. **The ETA/searcher ecosystem is a promotion surface the prior pass never examined:** Searchfunder
   (10k+ members, ~80% of active searchers), the EBIT community, SMB X, two sponsor-carrying
   podcasts (Acquiring Minds, Acquisitions Anonymous — guest free first, sponsor at ~$1–2.5k/ep only
   after guesting proves the message), three newsletters (BizNexus 40k readers, SMB Deal Hunter, The
   Business Inquirer), and a 2026 conference calendar including the **Self-Funded Search Conference,
   Nov 7–9, 2026, Dallas** (~200 searchers; attend, don't sponsor — its sponsor/speaker list doubles
   as a named QoE prospect list). Consultants market themselves in these venues, so presence there
   reaches the customer directly while also creating demand-side pull from buyers — consistent with
   the consultant-is-the-customer guardrail (`spec.md` §1–2).
3. **A warm DueDilio door exists earlier than planned:** DueDilio's founder personally runs The
   Business Inquirer (3,800+ subscribers, explicitly covers tools). Pitching the free sample audit
   as newsletter material is the soft opening of that relationship. **This supersedes the Phase 2
   bullet below about approaching DueDilio directly** — the formal partnership pitch stays gated
   (see §5) on 3–5 nameable customers; the newsletter touch is the only DueDilio-adjacent move
   before that.

Deprioritized on evidence: LinkedIn cold ads (CPC $7–15 against an audience small enough to reach
one-by-one free; retargeting only, ≤$500/mo, once traffic exists), NAGGL/SBA-lender motion ($2,095
to attend, second-order referrals), BDO Alliance vendor program (real, with SaaS precedent — a
year-two motion, recorded so it isn't forgotten), conference *sponsorship* of any kind in year one.
SMB-angle SEO (the "technology due diligence checklist" SERP is 100% enterprise incumbents; the
main-street angle is unserved) is a background channel: 2–3 cornerstone pieces in weeks 8–12, 6+
month payoff.

**The 90-day sequence** (assumes launch ≈ early Oct 2026, ≤$3,000 cash; full detail in
`docs/research/promotion.md`): weeks 1–2, build the 60–100-firm list, produce one polished free
Tier-A sample audit on a real live listing, run the 20-LinkedIn-vs-20-email A/B; weeks 1–4 in
parallel, Searchfunder/EBIT presence and pitch the sample audit to The Business Inquirer; weeks
3–8, outreach at 15–20 contacts/week on whichever channel won the A/B, pitch podcast guest spots,
one paid newsletter test (~$200–500); week ~6, attend SFSC Dallas targeting the diligence-firm
sponsors; weeks 8–12, IBBA Supplier Directory listing ($595–895) if reply rate <5% after ~60
contacts, publish the SEO cornerstone pieces, then decide on paid escalation — **gated on 3–5
nameable customers**, per `docs/research/distribution.md`'s original trigger.

*Timing dependency:* the sequence's "launch ≈ early Oct 2026" start assumes `roadmap.md` Phase 2.5
(billing, email, instrumentation — estimated 2–4 weeks from 2026-09-21) completes on the short end;
billing is the critical-path item. If Phase 2.5 slips, the week numbering shifts with it — except
SFSC Dallas (Nov 7–9), which is a fixed external anchor: attend regardless of launch state, since
its sponsor/speaker list doubles as a prospect list and outreach can run against a private-beta
product with the free sample audit as the hook.

**Channel correction (2026-09-11, `docs/research/distribution.md`):** DueDilio's provider network is
not a contactable list — provider identities are redacted on their own network page by design (see
`docs/idea.md`'s correction note). "DueDilio-listed providers" below means *consultants/firms who
happen to be found through other means and who may also be DueDilio providers*, not "cold-email
DueDilio's directory," which isn't possible. The actual primary channel is a manually-built list from
IBBA's Supplier Directory, AM&AA's public member/conference presence, and direct search/LinkedIn
discovery of firms that already publicly advertise technology/IT due diligence — backed by a free
Tier A audit run on a real live business-for-sale listing as the outreach hook (`docs/research/
distribution.md`'s recommended first-10-customers motion). Budget 8–12 hours/week for 6–8 weeks for
this manual motion; expect a first reply/meeting in 2–4 weeks, not immediately.

- **Phase 0:** direct, individual outreach to a hand-picked list of ~15–30 consultants/firms, sourced
  as above (not from DueDilio directly), split across two populations — existing technology-DD
  providers and QoE generalists/IT consultants without a technology-DD line yet (`docs/spec.md` §12)
  — for discovery calls. No public presence needed yet.
- **Phase 1:** stay dark publicly. The 2–3 design partners are recruited from Phase 0's calls, not a
  launch. Resist the temptation to "announce" anything before there's a real report a real buyer has
  seen.
- **Phase 2:** first public surface — a pricing page and self-serve signup. Light announcement in
  channels where M&A/QoE consultants actually are (LinkedIn groups/communities for deal
  professionals, not general tech/startup channels). ~~This is also the point to approach DueDilio
  about a listing or partnership conversation~~ — superseded by the 2026-09-21 channel update above:
  the Business Inquirer newsletter touch is the only DueDilio-adjacent move until the 3–5-customer
  gate is met.
- **Phase 3:** the distribution-channel decision from `roadmap.md` Phase 3 gets executed here —
  whichever of (a) marketplace partnership/listing, (b) continued direct outreach at scale, (c) another
  channel won out on evidence. GTM spend/effort concentrates on that one channel rather than spreading
  across all three speculatively.
- **Phase 4:** GTM shifts from acquisition to expansion within existing paying firms (seats, API
  access) — different motion (account expansion) from earlier phases (net-new consultant acquisition).

## 5. Launch gates (go/no-go checklist per channel transition)

**Before opening public beta (Phase 2):**
- [ ] At least one design partner's real-deal report was used unmodified by the buyer's side
  (`roadmap.md` Phase 1 exit criteria).
- [ ] Multi-tenant data isolation (`spec.md` §8) has been explicitly reviewed, not just assumed from
  the data model design — this is the point where a stranger's data starts landing in the system.
- [ ] Pricing tiers finalized from Phase 0/1 evidence (`spec.md` §9 numbers are placeholders until
  this gate — including the $99–149 per-audit overage band from §9's second revision note, which
  must be in the head-to-head test, not assumed).
- [x] **Billing exists and has taken a real (test-mode) payment end-to-end** (closed 2026-09-22).
  *Evidence:* `tests/integration/stripe-billing-e2e.itest.ts` drives real Stripe test-mode objects —
  customers carrying server-set `metadata.orgId`, subscriptions (including the two-line Team shape),
  signed webhook events delivered to the real route with real signature verification, and a real
  $129 PaymentIntent confirmed and then refunded to zero. Note what this does **not** close: the
  Phase 2.5 exit criterion asks for a *live-mode* charge and refund, which needs credentials only the
  founder can provision (`docs/BLOCKED.md` §1), and `BILLING_ENFORCEMENT` stays `false` until then.
  The shape required by `spec.md` §9 as revised is implemented and covered: annual-credits plan as
  the lead offer, monthly second, per-audit overage billed as a monthly rollup invoice rather than
  one charge per audit (`docs/research/profitability.md`'s lever #4).

  **How to re-verify, because CI does not.** That suite creates real objects against a real Stripe
  test-mode account, so CI opts out of it explicitly (`CLOSECHECK_SKIP_STRIPE_E2E`). It is a manual
  pre-release check, not a per-push one: run `npm run test:integration` on a machine with
  `STRIPE_SECRET_KEY` (an `sk_test_` key) and `STRIPE_WEBHOOK_SECRET` set. If neither the key nor
  the opt-out is present the suite now fails rather than skipping — it used to skip silently, which
  meant this gate reported itself verified on every run while asserting nothing.

  *Superseded note (2026-09-21), kept rather than deleted:* "the pricing page is display-only — no
  payment dependency or billing code exists anywhere in the app. Public beta with signup but no
  payment path burns the one first-impression each prospect gives us."

- [~] **Transactional email delivery exists** (team invites, portal-link delivery, receipts) —
  **code complete 2026-09-22, gate NOT closed.** Sending is implemented (Resend, with a LOGGED
  fallback when unconfigured) and a real send-restricted API key is configured, so the copy-paste-URL
  era is over. It stays open because Resend's sandbox restriction means mail currently delivers only
  to the account owner's own address until a sending domain is verified — and this gate is about a
  *stranger* receiving an invite, which is precisely what still cannot happen. See
  `docs/BLOCKED.md` §2.

  *Superseded note (2026-09-21), kept rather than deleted:* "as of 2026-09-21 these are copy-paste
  URLs with no delivery mechanism, a hard self-serve conversion blocker."

- [x] **`spec.md` §11 success metrics are instrumented, not just defined** (closed 2026-09-22).
  Activation, the second-audit retention proxy, and report-usage signals are recorded to
  `metric_events` (write-only for the app role — `SELECT` is revoked rather than relying on RLS),
  with `error_events` alongside. The founder's read path is a DIRECT-role CLI, deliberately not a
  web surface: a cross-org read endpoint in the app would be new tenant-isolation attack surface in
  a product whose documented core risk (`spec.md` §8) is exactly that.

  *Superseded note (2026-09-21), kept rather than deleted:* "as of 2026-09-21 no analytics or event
  tracking exists in the codebase."

**Before any GTM push toward a marketplace partnership (Phase 3):**
- [ ] The distribution-channel decision (`spec.md` §12) has actually been made from evidence, not
  defaulted to "try the marketplace" because it was the more obvious-sounding option.

**Before enabling the Phase 4 depth set (read-only API, webhooks) for customers:**

*Status note: this feature set is being built ahead of `roadmap.md` Phase 4's "re-plan from Phase 3
evidence first" gate, per explicit user direction on 2026-09-21 — the same override pattern recorded
for the Phase 3 Client Portal (`spec.md` §7, `roadmap.md` Phase 3). Building ahead does not waive the
gates below: they gate customer enablement/announcement, not code existing.*

- [x] **API keys verified org-scoped at the RLS layer** (closed 2026-09-22), not just application
  code — an API request with a valid key for org A provably cannot read org B's rows (`spec.md` §8,
  §13.2), demonstrated by an actual cross-org request test, not code inspection alone.
  *Evidence:* `tests/integration/api-tenant-isolation.itest.ts` — 17 assertions driving a running
  server over HTTP with real bearer tokens for two real orgs. The proof is stronger than a passing
  test usually is: the v1 route handlers query by primary key with **no `orgId` in the where
  clause**, so a 404 for a foreign id can only have been produced by the RLS policy — there is no
  application-level filter that could have produced it. A second block repeats the assertions
  directly against the scoped connection with no route handler involved, so a later refactor that
  reintroduces an application-level filter cannot make the suite pass for the wrong reason. Reads,
  lists, counts, updates and deletes are covered in both directions, plus the 401 paths.
- [x] **Webhook payloads confirmed to carry identifiers and status only** (closed 2026-09-22) — no
  findings content, no document data (`spec.md` §13.3) — checked against the real serialized
  payload, not the intent.
  *Evidence:* `tests/integration/webhook-payload.itest.ts` — runs the real dispatcher against a real
  endpoint row and intercepts the outbound request at `fetch`, asserting on the exact bytes that
  would have gone over the wire. The fixture plants sentinel strings in the audit's finding note and
  `structuredData` so a leak has something recognizable to be caught by. Payload keys are checked
  against an **allowlist**, not a denylist, so a future event carrying an unforeseen field fails the
  gate rather than shipping quietly.
- [ ] At least one paying firm has asked for programmatic access or an integration, or the feature
  ships dark (built but unannounced) until one does — announcement effort follows evidence, per §4's
  Phase 4 expansion motion. **Open, and correctly so:** there is no paying firm, so the feature stays
  dark. This is the gate working rather than a gap — see `docs/BLOCKED.md` §6.

**Before v2.0 / any credential-handling feature:**
- [ ] A specific design partner has stated, in a specific deal, that lack of Tier C automation cost
  them something concrete (lost time, lost deal, lost client) — not a generic "would be nice."
- [ ] A secrets-vault architecture has been designed and reviewed independently of the rest of the
  product before any credential ever touches the system (`spec.md` §8 and §4).

## 6. Incident / rollback posture

No formalized on-call process needed at `v0.x`/private-beta scale (2–3 known users, direct
communication). Before public beta (Phase 2 gate), establish:
- A basic rollback path for bad deploys (standard for the chosen deploy pipeline — nothing
  CloseCheck-specific).
- A defined incident-communication path for a data-isolation or data-loss incident specifically,
  given §8's framing that this product's core risk is reputational, not just availability. A leak
  affecting one consultant's one deal is a reputational event for every consultant on the platform —
  treat any confirmed cross-tenant data exposure as sev-1 regardless of how small the blast radius
  looks.
