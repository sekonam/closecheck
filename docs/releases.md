# CloseCheck — Release Plan

Status: **v0.1 draft**. Defines how work in [`roadmap.md`](roadmap.md) actually ships, to whom, and
in what order — separate from the roadmap's product sequencing.

## 1. Versioning scheme

Product versions track roadmap phases, not every deploy:

| Version | Meaning |
|---|---|
| `v0.x` | Pre-launch and private beta — Phase 0 discovery artifacts through Phase 1 design-partner usage. No public pricing, no self-serve signup. |
| `v1.0` | First self-serve-capable release — end of Phase 2 (template expansion + team plans + pricing page). This is "GA" for the purposes of public announcement. |
| `v1.x` | Incremental Phase 2/3 additions (new templates, portal) between major milestones. |
| `v2.0` | Reserved for the first release that materially changes the core loop (e.g., Tier C credential handling, if Phase 3/4 evidence ever justifies it) — not for routine feature additions. |

The web app itself deploys continuously (no user-facing version number on every deploy); the `vX.Y`
labels above are for customer-facing changelog and GTM communication, aligned to roadmap phase
boundaries.

## 2. Release channels

| Channel | Who | Gate to enter |
|---|---|---|
| **Private beta** | The 2–3 design partners from Phase 0 | Manual selection; white-glove onboarding |
| **Public beta** | Anyone who signs up once self-serve exists | Opens at start of Phase 2 |
| **GA (`v1.0`)** | Public, with pricing live | Phase 2 exit criteria met (`roadmap.md`) |

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

## 4. Go-to-market plan (tied to phases)

GTM decisions live here, not in `spec.md`, because they're about *when and how to reach the market*,
not what the product is.

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
  professionals, not general tech/startup channels). This is also the point to approach DueDilio
  about a listing or partnership conversation, now that there's a live product to point to rather
  than a pitch.
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
  this gate).

**Before any GTM push toward a marketplace partnership (Phase 3):**
- [ ] The distribution-channel decision (`spec.md` §12) has actually been made from evidence, not
  defaulted to "try the marketplace" because it was the more obvious-sounding option.

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
