# CloseCheck — Product Specification

Status: **v0.1 draft**. This is the first detailed specification, written directly against
[`idea.md`](idea.md). Where `idea.md` left a question open, this document makes a decision and
records the rationale — those decisions are working hypotheses to be pressure-tested with real
consultants during Phase 0 of the [roadmap](roadmap.md), not settled facts. §9 has already been
revised once, against dedicated pricing/market/competitor research in [`docs/research/`](research/) —
see that directory for the underlying evidence behind any section marked as research-revised.

## 1. Who this is for

**Buyer (who pays):** an independent technology-diligence consultant, or a small QoE/M&A advisory
firm, running paid due-diligence engagements on small business acquisitions ($200k–2M deal band).
Typically solo or 2–10 person firms. Examples of the target list: DueDilio's 200+ listed providers,
Rapid Diligence-style QoE shops.

**End reader of the output (who does not pay):** the acquisition buyer and their advisory team
(attorney, accountant, broker), who receive the report as part of a diligence package the consultant
already sells them.

**Non-goal:** CloseCheck never sells directly to the acquisition buyer. Every feature decision should
be checked against "does this make the *consultant's* job faster/more credible" — not "does this help
the buyer."

## 2. Product principles

1. **The report is the product.** Consultants are not buying a checklist app; they're buying a
   client-ready deliverable they can hand over under their own name. If a feature doesn't improve
   what ends up in the client's hands, it's secondary.
2. **Repeatable over custom.** The value proposition against "ad hoc, no repeatable process" (per
   `idea.md`) is consistency across engagements. Templates and checklists are first-class, versioned
   objects — not free-text notes. The same applies to what a firm learns by running them: what it
   recorded about a vendor on one deal is a first-class object too (§3's Vendor Term Profile),
   available as reference on the next deal rather than living in one consultant's memory.
3. **Tier boundaries are load-bearing, not cosmetic.** Tier A (no seller cooperation), Tier B
   (seller/broker documents), Tier C (live access) map to real friction and timing constraints in a
   live deal. The product must never blur them — a consultant needs to know exactly what they can run
   *before* an LOI vs. what requires seller cooperation they may not have yet.
4. **Whitelabel by default.** The consultant's brand is on the report; CloseCheck is infrastructure,
   like a QoE firm's internal Excel template today, except mentioned in Phase 3+ if the consultant
   opts in to co-branding.
5. **Trust is the hard constraint, not features.** Tier C means live credentials to a seller's
   hosting/CMS/POS/booking accounts flowing through this system. Every design choice near credential
   handling defaults to the least amount of retained data. See §8.

## 3. Core domain model

| Object | Definition |
|---|---|
| **Consultant Org** | The paying account — a solo consultant or firm. Has seats (each with a role, see below), a plan, and a brand kit (firm name, colour, logo) for whitelabeled output — the report footer is rendered from those rather than being a field of its own. |
| **Engagement** | One acquisition deal being diligenced. Belongs to a Consultant Org. Has a target business, a deal stage (pre-LOI / post-LOI / closing / **closed / dead**), and one or more Audits. The two terminal stages are not decoration: §8's retention default keys on them, so a reader who knows only the first three does not know deletion is ever scheduled. Nothing constrains an Engagement to a single Audit — re-auditing after remediation is supported — and each Audit that proceeds past Tier A consumes a credit (§9): creating it and running Tier A on it is included; its first Tier B/C entry is what spends the credit. |
| **Template** | A versioned checklist definition for a business type (see §5). Defines which checklist items exist, which tier each belongs to, how each is scored, and what structured evidence each captures (§4). Templates are shared, product-owned content — a consultant selects one per Engagement and cannot edit the shared template from inside an engagement. **Engagement-specific custom items are NOT built**: this table described them from v1 and no implementation ever existed, so the only way to record something outside the fixed item list is the free-text note on an existing finding. Recorded as unbuilt rather than quietly deleted, because the need it was written for is real and a consultant will hit it; whether to build it belongs in §12 alongside the other unresolved scope. |
| **Audit** | One run of a Template against one Engagement. Holds the state of every checklist item: not started / in progress / pass / fail / not applicable / blocked (seller cooperation not yet available), plus evidence (notes, uploaded documents, screenshots) per item. |
| **Finding** | A checklist item's resolved state plus its evidence and severity. The unit that renders into the Report. |
| **Vendor Term Profile** | What this firm recorded about a named vendor (Toast, Square, Mindbody), on a named checklist item, on a named Engagement. Derived from a Finding's structured capture (§4) and owned by the Consultant Org — unlike a Template, this is one firm's reading of its own clients' documents, not shared product content. Shown back as reference on a later Audit of the same vendor, never as a prefilled answer. See below. |
| **Report** | Generated, versioned, exportable output of an Audit at a point in time. See §6. |
| **Client Portal Link** | A scoped, revocable read-only view of a Report for the buyer. See §7. Phase 3+. |

### Seats carry a role, and the line is scope, not seniority

Every seat in a Consultant Org has a role — Owner or Member — and the role decides exactly one thing:
whether this person may change the *firm*. It does not decide who may do diligence.

The division is scope, not seniority: does the action belong to an Engagement, or to the firm? A Team
plan exists so a firm's consultants can share engagements (§9), so a seat that cannot take an Audit,
attach evidence or issue a Report is a seat that cannot do the thing it is sold for — restricting the
work would defeat the plan it is sold under. The customer is a solo consultant or a 2–10 person firm
(§1), where a colleague correcting another colleague's Finding needs an audit trail, not a permission
wall; a wall there makes a partner the bottleneck on every correction.

**Firm-scoped — Owner only.** These change what the firm *is*, rather than what one deal says:

- billing and plan
- seats and team membership
- API keys (§13.2)
- webhook endpoints (§13.3)
- the brand kit: firm name, accent colour, logo (§2 principle 4)
- accepting the Report disclaimer on the firm's behalf (§6)

**Engagement-scoped — any seat.** Creating Engagements and Audits, recording Findings, attaching and
removing evidence, generating Reports, creating and revoking Client Portal Links, and emailing a link
to a buyer.

The boundary is written down here because the product asserted a role model in copy that no data path
read: the settings page told users "Only the account owner can invite or remove teammates" and "Only
the account owner can change the plan" — both true — while any Member could change the firm's name,
colour and logo, which rewrites the branding on every Report the firm has ever issued and every
portal link it has ever sent, including Engagements that Member never worked on. Role was consulted
in four places (team, API keys, webhooks, billing) and nowhere else. A stated rule that only some
call sites enforce is worse than no rule, because consultants price their own credibility on it.

**Seat and role are deliberately separate axes.** A seat is a person the firm pays for; a role is
what that person may change about the firm. The billing model does not answer the permission question
and should not be asked to — conflating the two is how a product ends up billing full price for
read-only accounts, or handing anyone who costs money the ability to cancel the plan. Stated
explicitly so neither is later tidied into the other on the grounds that they look redundant.

**The Report disclaimer is firm-scoped, but a different kind of firm-scoped item.** Every other entry
on the list can be Owner-only without ever stopping a Member doing diligence. This one gates
engagement work: Report generation is blocked until the firm has accepted the liability language
(§6). It stays Owner-only — accepting language that appears on every deliverable the firm issues is a
firm-identity decision, not a per-deal one — which makes the blocked-work message load-bearing. It
must name who can clear the block, not instruct a reader who cannot act: "review the report
disclaimer on the Branding page" is, to a Member, an instruction they cannot follow, and it presents
a firm-level prerequisite as something they personally got wrong. The same shape turned up the same
day in the credit-limit message, which told a Member to choose a plan — also Owner-only. Any
prerequisite a Member cannot clear themselves is written this way.

**Client Portal Links stay engagement-scoped, conditional on attribution.** Any seat may share a
Report, because delivering the deliverable is the job. But it is the one engagement-scoped action
with outward blast radius, and "any seat may do it" and "nobody can tell who did" must not both be
true — so the link records the seat that created it (§8).

**No read-only or observer role.** No evidence anyone wants one, no design partner has asked, and §12
already carries enough unvalidated shape without a third role added for symmetry. A role that lets
someone see a firm's engagements without touching them needs a real trigger — a firm naming the
person they want to give a view and not a voice — before it earns a place in the model.

### Vendor Term Profiles are reference, never prefill

A consultant running their tenth restaurant deal has read the Toast agreement before, and §2
principle 2 sells exactly that continuity. So when an Audit reaches a checklist item about a vendor
the firm has already recorded terms for, the item shows what was recorded, which Engagement it came
from, and when.

**It does not prefill the finding, and that is the decision rather than an implementation detail.** A
prefilled value is indistinguishable — in the audit form, and then in the generated report — from one
the consultant read out of *this* deal's contract. The failure that design invites is the previous
deal's termination penalty shipping to this buyer as a finding about their target, with the
consultant's name on it and a severity attached: the product manufacturing a false statement of fact
about a business, which is the one thing a diligence deliverable cannot do. The recall surface is
reference only and offers no control that writes into a Finding. What it keeps is the part that
helps — knowing what to look for before reading the contract, and seeing where this contract differs
from the last, which is itself worth stating in the report, since either the terms were negotiated
differently or one of the two readings is wrong.

Two structural consequences:

- **A reading belongs to an Engagement, not to a vendor.** With one row per vendor, the deal being
  audited overwrites the reading it should be compared against, so the recall disappears at the
  moment the consultant records their own answer — exactly when the comparison matters.
- **Readings cascade away with their Engagement,** so they cannot outlive the §8 retention of the
  documents they were derived from.

## 4. The three tiers (detailed)

Carried forward from `research/bizbuysell-main-street-tech-audit/build.md` via `idea.md`, expanded
into an implementable structure. Each checklist item in a Template declares:

- **Tier** (A/B/C) — see below
- **Method** — `automated` (system runs a check with no human input) or `manual` (consultant records
  a finding by hand, optionally attaching evidence)
- **Severity model** — traffic light (Green / Yellow / Red) plus a free-text finding note; Red items
  require a note, Yellow items recommend one, Green items don't need one. The Red-requires-a-note
  rule is enforced when the finding is saved, not advised in the UI: an unexplained Red is the
  finding a buyer's advisory team pushes back on hardest, and it was specified here long before
  anything enforced it.
- **Blocking dependency** — whether the item requires deal-stage access the consultant may not have
  yet: none, seller documents, or live access. Declared on the item and compared against the
  Engagement's deal stage, so a consultant can see before starting which items aren't runnable yet —
  this is §2 principle 3's pre-LOI/post-LOI separation made machine-readable rather than left to the
  consultant to infer from the tier. **Advisory, never enforced:** a cooperative broker hands over
  contracts earlier than the tidy model expects, and a consultant holding the document must be able
  to record the finding whatever stage the Engagement is nominally at.
- **Structured capture** — the typed fields this item turns its evidence into, declared per item
  (see the Tier B note below)
- **Evidence expectation** — `none`, `document`, or `attestation`: what a rating on this item is
  supposed to be resting on. **Decision:** declared explicitly per item rather than inferred from
  the tier. Tier is usually a good proxy (Tier B wants a document, Tier C an attestation) but not
  always — a Tier A manual item like Google Business Profile claim status rests on the consultant's
  own observation with nothing to attach, and inferring an expectation there would report a
  permanent, unclosable gap on a finding that is complete. The reason to declare it at all is §6's
  evidence-coverage signal, which needs an honest denominator: the count of items that were supposed
  to have something behind them, not the count of items.
- **Verification procedure and severity rubric** — how to actually run the item, and where the
  Red/Yellow/Green thresholds sit. Both are **internal**: shown to the consultant in the app, never
  rendered into the client report. That split is not a presentation preference — it exists because
  internal methodology text carrying literal `spec.md §N` cross-references leaked into the
  whitelabeled PDF through the item's client-facing description, which is the one string on the item
  a buyer reads. Recording thresholds also serves §2 principle 2 directly: an unstated threshold
  makes one consultant's Yellow another's Red, which is the opposite of the repeatability being
  sold.

**Thresholds name their source, and say so when there is none (decision, template v4).** In a
document a consultant bills for, a threshold written from domain knowledge is indistinguishable from
one traced to a published rule — and several written from domain knowledge turned out to be wrong,
not merely unsourced (§5). Every threshold therefore names the publication it comes from and the date
it was read, and where the underlying rule is revised periodically — the card-network monitoring
programs, the ICANN Transfer Policy, the CA/Browser Forum validity schedule — the item tells the
consultant to re-verify at the audit date and to state which version was applied — which §4.6 has
since turned from an instruction into a mechanism, because telling the consultant to carry it was
the wrong half of the answer.

**A rubric must describe what the product actually computes (decision, template v5).** Where an item
is rated automatically, the rubric and the runner are two statements of one rule, and a consultant
reading a rubric that contradicts the rating will correct the product towards the wrong answer.
Two of v4's rubrics did: the certificate threshold said to rate on proportion of lifetime when the
runner applies the shorter of a proportion and a day cap, and the domain-expiry threshold was
written relative to an expected close date that does not exist in the data model. Both are corrected
in v5. The general obligation this creates: **an automated item's rubric either matches the runner
or says explicitly what the automated rating could not see.** The second is a legitimate answer —
the close-date gap is stated rather than closed, because closing it would mean inventing a date the
consultant never gave us — but silence is not.

**The report's disclaimer names what an automated check cannot establish (legal-content change,
2026-09-22).** The paragraph previously singled out Tier C as "consultant-attested observations, not
automated verifications", which invited a buyer's counsel to take everything else as verified — and
after v6 that was the last place in the document still implying it, since the per-finding status and
the rating summary already say otherwise. It now adds that a finding shown as in progress carries a
rating the consultant has not confirmed, and that automated checks read public records and cannot
establish who controls an account.

Recorded as a decision because changing this text is not a content edit: it invalidates every
organisation's prior acknowledgement by design, since `ConsultantOrg.disclaimerAcknowledgedAt` means
only "this owner reviewed the text as it read on that date". Migration
`20260922214500_disclaimer_scope_of_automated_checks` clears the column. Made now precisely because
one development organisation had acknowledged the old text and no real firm had — the same edit
after the first paying customer is a re-acknowledgement cycle for every one of them.

**An automated pass says what it checked (decision, template v6).** v5 made the rule and then broke
it by omission: its scope was set by the two divergences that had been noticed, and three more sat
unexamined in the same template. Those three were worse, because they ended in a *confirmed* pass
rather than a disagreement — the DNS and mail-provider checks returned a finished Green having
identified a provider, while their rubrics reserve Green for accounts the seller can demonstrate
control of and that are on the asset schedule. A target whose DNS sat with an agency outside the
sale, which those rubrics call **Red**, produced the same confirmed Green as one where control had
been proved.

Two things follow, and the second is the one that generalises.

*What an automated check may claim.* Where a rubric requires something no automated check can
observe, the item states what the automated pass covered, and the runner returns a rating marked in
progress rather than finished — so it counts as awaiting confirmation in §6's coverage rather than
as a completed rating. The severity is not reduced: what was observed is genuinely unremarkable, and
downgrading it would invent a concern rather than state a gap. On a clean domain six of the seven
automated items now read as awaiting confirmation, and only the certificate check reports a finished
pass, because everything its threshold turns on is inside the certificate. That ratio is the honest
description of what Tier A is — fingerprinting public records that a consultant connects to the deal
— and presenting most of it as finished was the overstatement.

*Why the comparison is now enforced rather than remembered.* `src/lib/audit/rubricAlignment.ts`
records, for every automated check, what the runner can determine and what its rubric asks beyond
that; the suite fails when a runner has no judgement recorded, when an item admitting a gap does not
state it in the published rubric, or when such an item claims a finished pass. Writing it caught two
entries that broke the rule stated in its own docstring, which is how a rule that lives only in a
docstring goes. The harder half of
the same rule, and the one that makes this content defensible: **where no authoritative source
exists, the item says so and gives the consultant the reasoning and the retrieval method instead of a
number.** The domain-expiry threshold is stated as *this firm's* basis, with the derivation shown and
explicitly not presented as an industry standard, because no industry standard exists; reserve
percentages, the "letter of good standing" a seller may offer, certificate-expiry day counts and
registrar restore fees are all handled the same way. An uncited threshold is worse than no threshold,
because it invites a challenge from the buyer's advisory team that it cannot answer.

### Tier A — external, no seller cooperation needed

Runnable pre-LOI, even pre-offer, from public information only.

| Item | Method |
|---|---|
| Domain/registrar ownership, expiration, last transfer, and registration status | automated (RDAP, with legacy WHOIS as fallback) |
| DNS provider and hosting fingerprint | automated |
| SSL/TLS certificate validity, issuer, expiration | automated |
| CMS identification and version/patch status (e.g. outdated WordPress plugin) | automated, best-effort |
| Email authentication posture (SPF / DMARC records; DKIM best-effort — see note) | automated (added 2026-09-21, §13.1) |
| Mail provider fingerprint (MX records — who hosts the business's email) | automated (added 2026-09-21, §13.1) |
| HTTPS hygiene (HTTP→HTTPS redirect enforced; HSTS observed) | automated (added 2026-09-21, §13.1) |
| Google Business Profile ownership and claim status | manual (no reliable public API for claim status) |
| Social account ownership (which accounts exist, who administers them per public info) | manual |
| Trademark conflict scan on business name / domain | manual, consultant-triggered (search, not filed automatically) |
| Authentication verdicts on a real message from the business's sending system | manual (added 2026-09-22, template v4) |

DKIM note (methodology constraint, not an implementation detail): DKIM records live under
per-provider selector names that cannot be enumerated from public DNS, so the check probes common
selectors (`google`, `selector1/2`, `k1`, …) best-effort. A found record is evidence; a not-found
result is **not** evidence of absence and must never lower a severity on its own — the finding note
says what was probed and defers to SPF/DMARC (which are deterministically checkable) for scoring.

That constraint is what the table's last row exists to answer: the only thing that can grade DKIM is
a real message from the business's own sending system, read for the selector and signing domain in
its `DKIM-Signature` header and for the receiving system's own `Authentication-Results` verdicts.
**Decision: that item declares its evidence expectation as `document`, not `attestation`, though the
bullet above frames a document expectation as the Tier B proxy.** An attestation is satisfied by any
non-empty structured capture, and a Tier A item has structured capture of its own — here the verdicts
the consultant transcribes, on the automated items the runner's own check output. An `attestation`
expectation would therefore have been satisfied by the item recording its own answer: the finding
would present as evidenced while the one artifact the item exists to obtain — a received message
carrying its `Authentication-Results` header — was never attached, and §6's evidence coverage would
have no way to say so. `document` is the expectation that makes a missing message countable, and
that countability is the entire reason this is a checklist item rather than a sentence in the
automated item's finding note.

Tier A is the automation surface. It's also the free/first-touch surface: a consultant can run Tier A
on a prospective deal before they've even been engaged, which is a plausible top-of-funnel hook (see
`roadmap.md` Phase 1).

### Tier B — seller/broker-provided documents

Requires the seller or broker to hand over documents; typically available once diligence has formally
started (post-LOI in most deals, sometimes earlier if broker is cooperative).

| Item | Method |
|---|---|
| POS system contract terms, term length, early-termination penalty | manual, document upload + structured fields |
| Customer-facing platform contract and transferability clause (online-ordering, booking, storefront, or franchisor-contracted equivalent) | manual, document upload + structured fields |
| Payment processor account standing (chargebacks, holds, reserve) | manual, document/statement upload |
| Terminated-merchant file (MATCH / VMSS) exposure | manual, acquirer inquiry + purchase-agreement representation (added 2026-09-22, template v4) |
| Processing continuity at close | manual, document upload + structured fields (added 2026-09-22, template v4) |
| Recurring SaaS inventory: what tools, what each costs, transfers vs. must-rebuild | manual, structured table the consultant fills from seller-provided list |

The transferability row is **universal** — every Template instantiates it in its own vertical's
language (§5). It is stated here, in the base table, because the alternative was tried and failed:
v1/v2 expressed it only as the restaurant Template's online-ordering contract and the salon
Template's booking contract, which left the franchise and e-commerce Templates with no
transferability item at all. A base item that lives in one Template's list is silently missing from
every other one.

**Decision: the payment rows are a three-way split of what was one item, where the evidence behind
them recommended four.** `docs/research/audit-thresholds-2026-09.md` §7.4 argued for separating
network monitoring-program standing, reserve/hold status, terminated-merchant-file listing, and
processing continuity at close. Reserves stay on the account-standing row: they are read off the same
processor statements and the same processing agreement as the chargeback and monitoring-program
picture, by the same person in the same sitting, and an item whose evidence is indistinguishable from
its neighbour's adds a row to the report without adding a finding. The other two split because their
evidence is not the statements at all — a terminated-merchant listing is not searchable by the
merchant and is answered by the seller's acquirer plus a representation in the purchase agreement,
and continuity is answered by the agreement's assignment clause and the buyer's own underwriting
timetable, which makes it a closing dependency and a working-capital item rather than a risk
measurement. Severity is the harder half of the reason: §6 rolls a tier up to its worst item, so a
listing that runs five years, attaches to the principal personally, survives closing the account and
survives later winning the disputes cannot be expressed at all while it shares one severity with a
reserve line.

Tier B items are inherently document-heavy. The product's job is to turn "here's a PDF contract" into
a structured, comparable finding (transferable: yes/no/unclear, penalty: $X or Y% of ARR) rather than
just storing an attachment.

**How that works:** each Template item declares its own field schema — typed fields (short text, long
text, enum, money, percent, date, boolean, plus a repeating table for inventories — which is how the
recurring-SaaS row above finally renders as the table it literally asks for, rather than as a note
box). The schema drives both the capture form and the report rows, so the comparable finding and the
thing the consultant fills in are the same object.

**Decision: the schema lives on the Template item row, not in application code.** The superseded
implementation hardcoded three keys — `transferable`, `penaltyAmount`, `penaltyBasis` — and decided
whether to show them by running a `/contract/i` regex against the item's *title*, so five of the
eight shipped Tier B items matched nothing and captured no structured data at all. They degraded to
"upload a PDF and write a sentence", which is exactly the behavior the paragraph above names as
insufficient. Fixing the coverage is the obvious half; the reason it moved onto the row is §5's
version pinning. A field set defined in code sits *outside* that guarantee — editing it would
retroactively change the meaning of every finding already recorded against it, all at once, with no
version to pin to and no migration story. On the row, the definitions are versioned by the same
machinery that versions the item's title, and an Audit reads both from the same pinned row.

### Tier C — live access verification

Highest friction, often deferred until very late pre-close or handled at closing itself. Requires
actual login credentials to seller-controlled systems.

| Item | Method |
|---|---|
| Live login to hosting/CMS admin | manual, consultant performs the check outside the product; product records pass/fail + notes |
| Live login to the primary operating system (POS, booking, or equivalent) | manual, same pattern |
| Live login to listing and social accounts | manual, same pattern |
| Data-export test (can the buyer actually get their data out) | manual, same pattern |

The two live-login rows were **one item** in v1/v2 — "Live login to POS/booking/GBP/socials" —
carrying four unrelated systems under a single pass/fail and a single severity. That cannot be read
through §6's roll-up: any single Red makes its tier Red, so a Red on a social account and a Red on
the point-of-sale produced an identical report, though what they cost a buyer is not remotely
comparable (losing the point-of-sale stops the business; losing a listing erodes demand over
months). Split in template v3. The bundled item stays in v1/v2 content, frozen, per §5.

**Product decision:** CloseCheck does **not** accept, store, or proxy live third-party credentials in
v1. Tier C items are recorded as consultant-attested findings (the consultant did the login themselves,
in their own browser/session, and reports the result) rather than the product performing an in-app
credential-based check. This removes the single largest trust/security liability from the MVP and can
be revisited only if a design partner explicitly needs credential handoff and a proper secrets-vault
architecture is built for it — not before. See §8.

### 4.6 Dated thresholds, and who holds them

Template versioning stops *us* moving a rubric underneath an audit in flight: `Audit.templateId` is
a hard FK, so an audit started on v4 stays on v4 (§3). It does nothing about the **world** moving
underneath a pinned template. Several of v4's thresholds are correct as of a date, and the sharpest
is ICANN's Transfer Policy — the revision removing the 60-day transfer lock was adopted 2026-06-07
(Res. 2026.06.07.04) with no effective date, no published implementation text, and registrars asking
for an 18-month buffer after implementation concludes. The 60-day lock is right today and will stop
being right without an announcement anyone is watching for.

v4 handled this in template prose: *RE-VERIFY AT THE AUDIT DATE*. Honest, and the wrong place — it
moves a maintenance burden we created onto the person paying us to carry less of it, which is
§2 principle 2 inverted.

**The rule is who can actually know**, because the dated facts are three problems rather than one:

| Kind | Example | Who holds it |
|---|---|---|
| **Scheduled** — change and effective date both published | CA/Browser Forum certificate-lifetime cap: 398 → 200 (2026-03-15) → 100 (2027-03-15) → 47 (2029-03-15) | **The product.** It holds the timetable and resolves the value at the audit date. Nobody is told, because nothing needs deciding. |
| **Adopted, undated** — change known, date genuinely unknowable | ICANN Transfer Policy revision | **The consultant**, at the audit date — the only party who can ask the registrar. Surfaced on the item, naming the specific change and what to confirm. |
| **Dated reading** — no known change, a fact read on a date that can move silently | A vendor help article's export retention window | **Us.** Never surfaced: a notice on most of the checklist teaches consultants to scroll past the one that matters. |

**Who re-verifies, concretely:** not a person who remembers. Every watched fact carries a review
date, and the test suite fails once it passes, naming the entry, what to re-read and the primary
source. That is the whole answer to the cadence question — the commitment was previously real and
unowned, and it is now a build failure. Declarations live in `src/lib/templates/policyWatch.ts` as
code rather than data, because they are product-owned facts like the templates, they must be
reviewable in a diff, and the enforcement is a test.

The consultant-facing notice is internal working context, not report content: a buyer reading "this
threshold may have moved" would take it as the firm hedging its own finding. It is rendered only in
the audit workspace, and a report test holds that line — internal methodology has reached a
whitelabeled PDF before (§7).

**Not claimed:** this catches facts someone thought to declare. A threshold nobody recognised as
dated is still silently wrong, and no mechanism here finds one.

## 5. Template library

One Template per business type, each a curated subset/superset of the tier structure above plus
type-specific items:

| Template | Distinguishing items beyond the base checklist |
|---|---|
| Restaurant with online ordering | POS-to-ordering-platform integration health, third-party delivery platform (DoorDash/UberEats) account ownership and menu sync |
| Salon/service business with booking | Whether the booking platform will release the client list and appointment history in usable form at all — appointment-history export fails outright on three of the four major platforms, one of which documents no ownership-transfer path and licenses the business's reviews to itself — recurring membership/package liability transfer, live verification of the client-record count and of the export the platform actually produces (Tier C) |
| Franchise location (any vertical) | Franchisor-mandated tech stack compliance (can the buyer even choose a different vendor), franchise-system SSO/account transfer process, who holds the customer-facing platform contract — location or franchisor |
| General e-commerce | Platform (Shopify/WooCommerce/etc.) ownership transfer mechanics, app/plugin inventory and licensing, payment gateway PCI scope, storefront contract terms including who owns the customer data |

**MVP scope:** ship with **one** template (Restaurant with online ordering — the highest-evidence
vertical in the source research) fully built, and the base tier structure factored so the remaining
three are additive, not rewrites. See `roadmap.md` Phase 2 for sequencing.

**Status:** all four Templates now exist, published at **v6**, ahead of the design-partner deal-flow
evidence the MVP-scope decision above called for (`roadmap.md` Phase 2's matching note). That
decision's reasoning is kept rather than deleted, per this project's convention: it was the right
call on the evidence available, and the risk it was managing — templates built without observed deal
flow — is now realized rather than avoided.

What v3 changed, beyond the two structural fixes recorded in §4: every manual item across all four
Templates carries a verification procedure and a severity rubric, where twelve previously had
neither; every document-backed and live-access item declares structured capture, where three did;
and the salon Template gained a Tier C item, having had none at all — for a business whose entire
value is a client list living inside a booking platform, and whose Tier B item recorded only what
that platform is *contractually obliged* to export, with nothing verifying that it does.

**v4 is the first revision whose severity thresholds carry sources**
(`docs/research/audit-thresholds-2026-09.md`, retrieved 2026-09-22). v3 gave every manual item a
verification procedure and a severity rubric; v4 is about where the numbers in those rubrics came
from, per §4's sourcing rule. Two of them were wrong rather than vague, and both are recorded here as
superseded rather than quietly replaced — a consultant carrying a v3 audit in flight is holding
findings rated against them and needs to know what moved underneath:

- **The fixed 30-day certificate-expiry rule is superseded.** It was the wrong *shape*, not merely
  the wrong number: maximum certificate lifetime is now 200 days and drops further on a published
  schedule, the CA ecosystem's renewal norm is proportional (renew at one third of lifetime
  remaining), and Let's Encrypt issues six-day certificates on which two days remaining is healthy.
  A fixed day count fires constantly on correctly-operating automated renewal, which trains a
  consultant to ignore it. v4 rates the proportion of lifetime remaining and whether renewal is
  automated, not the days on the clock.
- **Visa's VDMP and VFMP are superseded** — retired 2025-04-01 and replaced by VAMP, so any rubric
  still carrying their numbers is rating against a program that no longer exists. VAMP's merchant
  threshold sits above a monthly event floor no business in this deal band reaches, which makes Visa
  an acquirer-relationship risk here rather than an enforcement one; v4 puts the enforcement weight on
  Mastercard's ECM, which has a count floor a small business does reach and a previous-month
  denominator that mechanically inflates the ratio for a seasonal or declining business.

The rest of v4 is re-sourcing rather than correction: trademark rating moves off the Nice class onto
the identification wording, email authentication is re-stated against the current DMARC RFC and the
published mailbox-provider mandates (and gains §4's real-message item), domain posture is re-stated
against the ICANN Transfer Policy actually in force, and the Tier C data-export item gains
contactable-versus-row count, history depth and the post-close access window as captured fields.
Items the research does not touch are recorded as deliberately unchanged with the reason it does not
move them, so that "the evidence did not revise this" is distinguishable from "nobody re-read it" —
the failure mode v4 exists to correct is precisely that stale guidance and reviewed guidance look
identical. None of this is validation: no design partner has yet run an audit against any version of
this content. v4 makes the content more defensible, not more proven.

Templates are versioned (`v1`, `v2`, ...). An in-progress Audit stays pinned to the Template version
it started on; only new Audits pick up a new Template version. This matters because mid-engagement
checklist changes would silently invalidate a consultant's already-recorded findings. v3 is the
first revision to exercise that rule rather than merely state it: v1/v2 content is frozen
**including its defects** — the bundled live-login item, the missing transferability items — and the
improvements are applied as a new version rather than edited in, because an Audit already rated
against v2 was rated against v2's questions. v4 layers on v3 identically, and for the sharper reason:
its corrections change what a given set of facts *rates as*, so an audit scored under v3's 30-day
certificate rule stays readable against that rule rather than silently acquiring a different verdict.

## 6. Report generation

- **Structure:** cover page (business name, engagement date and deal stage, consultant/firm
  branding) → executive summary (one traffic-light row per tier, an overall rating, and the Red
  findings named individually) → tiered findings detail (grouped by tier, each finding showing
  status, severity, note, its structured fields, and evidence) → appendix (a listing of the documents
  relied on — see the decision below). The executive summary names what drove the rating because an
  overall Red a reader cannot trace to specific findings is an assertion rather than evidence — and
  tracing it is exactly what a buyer's attorney or accountant does first. Every page after the cover
  carries a running header and a numbered footer, so a page detached from a printed diligence pack
  still says whose report it belongs to.
- **Coverage says how much is rated AND how much of that a human has confirmed.** Tier A's
  automated checks write a status and a severity in one pass, so an item can carry a severity while
  its own note says "this is a fingerprint, not an assertion". Counting those as rated is true and
  incomplete: coverage exists so a badge cannot silently mean "nothing was checked", and a machine
  rating that asks to be checked is the same failure one level up. Measured against a live template
  before this was added: seven of eleven Tier A items rated, every one of them the machine's, with
  nothing anywhere saying so. So every place a coverage number appears — the audit workspace and
  the report both — names how many ratings are still in progress.

  The roll-up itself is deliberately untouched. A provisional Red is still Red: a machine finding a
  domain expired is a real risk the buyer must see, and discounting it until someone ticks a box
  would hide risk rather than qualify it. §6's worst-case rule does not depend on who did the
  rating. This qualifies the count, never the severity — and like evidence coverage it is a signal,
  not a gate, for the reasons recorded below.
- **Severity encoding:** every severity is carried on three channels at once — color, the written
  word, and a shape that escalates (circle → diamond → triangle). A traffic light encoded only in
  hue is unreadable in a greyscale photocopy and to the ~8% of men with a red/green deficiency, and
  this is a financial deliverable a stranger reads under the consultant's name.
- **Severity roll-up:** overall Audit rating = worst tier rating; tier rating = worst item rating
  within that tier, with an explicit rule that any single Red item makes its tier Red regardless of
  how many Greens surround it. Consultants can override the computed overall rating with a manual
  note explaining why (e.g., a Red item they've independently judged immaterial) — the override is
  always shown alongside the computed rating, never silently replacing it. "Always" includes the
  case where the override *agrees* with the computed rating: the report previously dropped the whole
  block whenever the two matched, which read as though no override had been made and removed the
  consultant's reasoning from the document precisely when it was corroborating the machine.
- **Evidence coverage, alongside rating coverage (decision).** The roll-up already refuses to let a
  severity badge stand alone, because a fresh Audit with nothing rated rolls up Green and reads as
  "verified safe" — a severity badge is a claim that something was checked, so how much of the Audit
  is *rated* travels with it. That principle stopped one level short. Rating coverage answers "is
  there a rating", which is one click; it does not answer "is there anything behind it". A Tier B
  contract item could be rated Green with no document attached and every structured field blank, and
  be presented identically to one backed by an executed agreement. Coverage is therefore reported on
  two axes — rated and evidenced — measured against §4's declared evidence expectation, at item,
  tier and Audit level, with ratings that have nothing behind them called out by name.
  **This is a signal, not a gate**, deliberately. Completing an Audit is the consultant's judgment
  call, and a seller who will not produce a contract is a real situation with a real finding attached
  — "terms could not be obtained", which §5's v3 severity rubrics rate explicitly. A product that
  refused to record that would be worse than one that shows the gap. It lives here rather than in
  §4's severity model because it qualifies a rating that already exists: §4 declares what each item
  expects, §6 reports what the Audit actually got.
- **The appendix lists the documents relied on; it does not reproduce them (decision).** This
  section previously specified "raw uploaded documents, if the consultant opts to include them"; that
  wording is superseded, and the reasoning is kept because the alternative keeps looking attractive.
  Embedding a seller's executed contracts and merchant statements into a PDF the buyer can forward
  anywhere is a confidentiality decision nobody makes deliberately — it just happens the first time
  someone attaches everything — and it multiplies the size of the deliverable for documents that are
  already retained and access-controlled under the firm's own retention policy (§8). The appendix
  instead states that the firm can provide any listed document on request, which is how every other
  diligence work product handles it. What makes a listing defensible rather than decorative is its
  provenance: each entry carries the consultant's own label for the document with the real filename
  beneath it, what the document is, how large it is, which finding it backs, its tier, and which named
  professional provided it and when. A bare filename gives a buyer's advisor nothing to check against,
  which is the bar §2 principle 1 sets for anything reaching the client; "who provided this, and when"
  is the half that makes the entry verifiable rather than a list of names of files. Entries attached
  before provenance was recorded degrade to what is actually known rather than printing unknowns.
- **Export formats:** PDF (v1, primary — this is what gets emailed/handed over in a deal), shareable
  link (Phase 3, see §7).
- **Whitelabeling:** consultant's logo, name, and color accent on the cover and footer of every page.
  No CloseCheck branding on the primary export in paid plans (see `docs/releases.md` for whether this
  is plan-gated).
- **Liability language:** every report includes standard disclaimer language (audit reflects
  information available at the stated date; not a substitute for legal/financial diligence) —
  required review by the consultant, not optional boilerplate the product silently inserts without
  them seeing it. Accepting it is firm-scoped: the Owner accepts on the firm's behalf (§3), and
  Report generation stays blocked for every seat until they have. Any change to this language is a
  legal-review item, not a routine content edit — flag it rather than edit it directly (see the
  `spec-writing` skill).

## 7. Client-facing portal (Phase 3+, not MVP)

**Status update:** built (2026-09-18), ahead of the design-partner evidence this section originally
called for, per explicit user direction to build through Phase 3 regardless — see
`docs/roadmap.md` Phase 3's matching note. The rationale below is preserved as the reasoning that was
superseded, not deleted, per this project's `spec-writing` convention for resolved-but-overridden
sections. The implementation matches the "magic-link, no account required" shape this section
specifies: `src/app/portal/[token]/page.tsx`, `src/lib/actions/portal.ts`. The portal serves the
report from its own streamed PDF route behind the same token resolution as the page — an earlier
build base64-inlined the whole file into the served HTML, which inflated every page load by ~33% and
is increasingly refused outright by mobile browsers, i.e. broken on the one surface the buyer sees.
Portal chrome carries the consultant's logo, name and accent rather than CloseCheck's (§2 principle
4), and both the page and the PDF route are `noindex` and `no-store`: a revocable link must never be
indexed or left sitting in a shared cache.

Deferred per `idea.md`'s open question, resolved here: **not core to v1.** Rationale: the PDF export
already satisfies "hand the buyer something professional," and a portal adds auth, hosting, and
support-surface cost before the core workflow (consultant runs an audit, gets a report) is validated
with real paying consultants. Building it early risks solving a problem ("buyer wants to click around
findings") nobody has confirmed exists yet.

When built (Phase 3), the shape should be: **magic-link, no account required for the buyer.** A
Client Portal Link is a scoped, time-boxed, revocable URL to a read-only rendering of one Report
version. No buyer login, no buyer account, no buyer data collected beyond what the link access log
needs. This preserves the principle that CloseCheck's customer relationship is with the consultant,
not the buyer — the buyer should never feel like they need a CloseCheck account to read a report about
their own deal.

## 8. Data security & trust (non-functional, but load-bearing)

This section exists because the product's core risk is not competitive, it's reputational: a leak of
one seller's business data (financials, contracts, credentials) during diligence for a deal that may
not even close would be catastrophic for every consultant using the product, not just the one
affected.

- **No live credential storage or proxying in v1** (§4, Tier C decision).
- **Multi-tenant isolation:** every Engagement, Audit, uploaded document, and Report belongs to
  exactly one Consultant Org. No cross-org data access path, including in support tooling — an admin
  impersonation feature must be scoped and logged per-org, never a blanket "view any data" mode.
- **Document retention:** uploaded Tier B documents (contracts, statements) are the most sensitive
  data at rest. Retention is tied to the Engagement lifecycle, with a consultant-configurable
  deletion policy. **N = 90 days (decision):** moving an Engagement into a terminal stage (closed or
  dead) with no purge date set fills one in, 90 days out — long enough to cover post-close questions
  and a dispute window, short enough that a dead deal's contracts and merchant statements aren't
  still held a year later for a business nobody ever bought. A date the consultant set themselves
  always wins, in either direction, including a deliberate blank on an already-closed deal: this is
  a default, not a policy imposed on them. Recording the number matters because the previous state
  implemented only the configurable half — the field existed and nothing ever wrote it unless the
  consultant filled in a form input that is blank by default and easy to miss, so "no indefinite
  default retention" was a promise the product did not actually keep.
- **A firm's reading of a document is as confidential as the document.** A Vendor Term Profile (§3)
  is the first tenant-owned object whose content is a firm's *interpretation* of a client's documents
  rather than the documents themselves; the isolation rule above applies to it unchanged, because the
  reputational risk this section is written against does not distinguish between leaking a seller's
  contract and leaking one firm's reading of it. Retention follows the same logic: readings are
  deleted with their Engagement, so a reading never outlives the retention of the contract it was
  taken from.
- **Outbound requests from consultant-supplied input:** Tier A checks fetch the Engagement's primary
  domain and write what comes back into the Finding — redirect chains and their `Location` headers,
  HSTS, the CMS generator tag, the TLS certificate's issuer and subject. That is a request-forgery
  primitive with a read channel attached, reachable by anyone through open self-serve signup, which
  is why it belongs in this section and not in §10. Two layers, because a name check is not an
  address check: `primaryDomain` must be a public domain name at input (a bare IP is refused even
  when public — every Tier A check reads domain-level records, so an address is meaningless to all
  of them, and refusing the shape is a smaller surface than allow-listing ranges), and the name is
  resolved and every returned address checked to be public before anything connects. Stated plainly
  because the opposite assumption is easy to make: **this is not a DNS-rebinding defence.** A record
  that changes between the check and the connection still wins; closing that needs address pinning
  or a network-level egress control, neither of which exists.
- **Audit logging:** who viewed/exported/shared a given Report and when, per Engagement — this is
  itself a feature consultants can point to when a buyer's advisory team asks "who's had access to
  this." Recorded for portal views (one row per human access) and for consultant-side exports — the
  moment the document leaves the system, which was previously logged nowhere at all — and surfaced
  to the consultant as a per-link trail. There is deliberately no "who" for an anonymous buyer (§7
  collects no buyer data beyond what the log needs, and the log stores a hash of the client address,
  not the address); views sharing an origin hash are grouped as "Viewer A/B" in first-seen order,
  which answers the question a consultant is actually asked without inviting anyone to read the
  grouping as an identity. The trail also records **which of the firm's own seats created a Client
  Portal Link** (§3): a firm could previously see that a Report had gone outside and who read it, but
  not which of its people sent it, so the trail stopped at the firm boundary in the one place that
  mattered — the only engagement-scoped action that reaches a party outside the firm. Attribution is
  optional rather than backfilled, because links created before it was recorded have no answer and
  assigning one would invent a fact about who shared a client's Report; and it outlives the person,
  because erasing the access history of a Report already sitting with a buyer at the moment a firm
  reorganises is exactly backwards.
- **Compliance posture:** no SOC 2 / compliance certification targeted for MVP; revisit once a design
  partner's own compliance requirements (or a firm's client contract) makes it a sales blocker, not
  before. Track this as a roadmap trigger, not a fixed date.
- **API keys and webhooks (Phase 4, §13):** API keys are CloseCheck-issued org credentials — hashed
  at rest, revocable, org-scoped through the same RLS enforcement as interactive sessions (the API is
  not an application-layer-only access path). Webhook payloads deliberately exclude findings content
  and document data — identifiers and status only — so a misconfigured receiver endpoint cannot
  become an exfiltration path. Neither feature stores or proxies any *seller* credential; the Tier C
  decision above is untouched.

## 9. Pricing & packaging (decision, resolving `idea.md`'s open question — revised from `docs/research/pricing.md`)

**Revision note:** the original decision here was a flat per-seat monthly subscription. Dedicated
pricing research (`docs/research/pricing.md`, 2026-09-11) stress-tested that against comparable B2B
practice-workflow tools and the buyer's actual usage frequency (2–50 audits/**year**, not per month)
and found flat-per-seat is the wrong default for a buyer this infrequent — it either overcharges a
light user into churning or undercharges a heavy user, and every comparable found (Content Snare,
Canopy, Suralink) either prices per-user for daily-use tools or sells enterprise/sales-assisted, not
flat-fee to an occasional user. The decision below supersedes the original; the reasoning stays here
rather than being deleted, per the `spec-writing` skill's convention that resolved decisions keep
their rationale.

**Second revision note (2026-09-21):** dedicated profitability research
(`docs/research/profitability.md`) re-benchmarked the model against closer structural analogs
(deliverable-generating tools for solo professionals: Spectora at $109/mo + per-published-report fee,
BizEquity ~$240/mo solo-advisor, Finsider.ai at $1,500–4,000 per QoE engagement) and against the
consultant's own $500–5,000 engagement fee. Two changes follow, superseding the numbers below where
they conflict (the original bands stay visible per this skill's convention):

1. **The per-audit overage test band moves from $49–79 to $99–149.** The original band captures only
   1.5–10% of the consultant's engagement fee; comparable deliverable tools capture ~6–16% of the
   human deliverable they replace. At near-100% marginal margin, this roughly halves the customer
   count needed for any MRR target. The Phase 0/1 head-to-head price test must include this band —
   the higher number is a hypothesis to validate, not a decision to skip validating.
2. **The annual-credits plan is promoted from "fallback" to lead offer.** Annual-default billing with
   a ~17% discount is the best-evidenced churn lever found (40–60% churn reduction in benchmarks),
   and matters more here than usual because ~43% of SMB SaaS churn lands in the first quarter —
   monthly-billed low-frequency buyers cancel between deals. Monthly remains available, positioned
   second.

**Hybrid: low base subscription + per-audit overage (or bundled audit credits).**

- **Base subscription, $29–39/mo (Solo, 1 seat).** Keeps the account valuable between engagements
  regardless of audit volume: template library access, whitelabel/brand-kit setup, and **unlimited
  Tier A runs** (external, no-seller-cooperation checks) — cheap to serve, and a plausible
  top-of-funnel/credibility tool a consultant can run pre-LOI on deals that never convert to a full
  audit. This is what answers the "dead months" problem a pure per-audit fee would have.
- **Per-audit fee for full Tier B/C audits, $49–79/audit**, with 2–3 included per year in the base
  plan so a brand-new low-volume user isn't asking "will this pay for itself" on audit one.
  *When* the fee applies follows from the line above and was made explicit on 2026-09-24: a
  credit is consumed by an Audit's **first Tier B/C entry** — a rating, a document, or a citation
  on a Tier B/C item, a generated report, or marking the audit complete — never by creating the
  Audit or running Tier A on it. The product says so on the audit page before the first such
  entry, so the billable moment is one a consultant sees coming. (The implementation consumed it
  at creation until then, which would have charged the screening this bullet includes.)
- **Team tier:** additional seats at $20–30/seat/mo on top of the base, once a Team plan exists
  (Phase 2, `roadmap.md`).
- **Simpler fallback if usage-based billing is too much for v1:** an annual-only plan with bundled
  audit credits (e.g., ~$588/yr including 6 audits, additional at ~$69 each) gets most of the same
  benefit without metered billing infrastructure — commits the buyer for a year (reducing the
  cancel-between-deals risk `docs/research/pricing.md` §3 flags for a low-frequency buyer) while still
  linking price to usage via the credit-overage mechanism.

At a blended ~$65/mo ARPU (`docs/research/pricing.md` §2), reaching $3,000 MRR needs roughly **47
customers**, $10,000 MRR roughly **154 customers** — see that document for the full sensitivity table
and for why the pure-per-seat and pure-per-audit alternatives were rejected. If the $99–149 overage
band validates, blended ARPU rises enough to roughly halve those counts
(`docs/research/profitability.md`); the same research moves the planning CAC midpoint to ~$700–1,200
(2025 blended B2B SaaS benchmarks), which weakens `docs/research/pricing.md` §5's LTV:CAC ranges and
makes the higher overage band load-bearing, not optional, for unit economics.

**The one number to validate before building any billing logic** (`docs/research/pricing.md` §7):
whether this buyer will pay a recurring fee at all for a tool used a handful of times a year, tested
head-to-head against a pure per-audit alternative — pitch both options to the Phase 0 discovery-call
list and record which one they pick and where price hesitation kicks in, before the hybrid model
above is treated as anything more than the best current hypothesis.

Indicative tiers (numbers are placeholders for Phase 0 validation, not commitments):

| Tier | Seats | Base | Included audits/yr | Overage | Notes |
|---|---|---|---|---|---|
| Solo | 1 | $29–39/mo | 2–3 | $49–79/audit (test $99–149 per second revision note) | Independent consultants |
| Team | up to ~5 | base + $20–30/seat/mo | scales with seats | same | Small firms |
| Firm | custom | custom | custom | custom | White-label options, priority support |

## 10. Technical architecture (initial recommendation)

No code exists yet; this is a starting recommendation to implement against, not a constraint imposed
by legacy decisions.

- **Application:** server-rendered web app (multi-tenant), standard modern stack (e.g. Next.js/React
  + a typed backend, or a monolith framework with strong multi-tenancy support) — no mobile app
  needed for v1; consultants work from a laptop during deal review.
- **Database:** relational (Postgres), with `consultant_org_id` scoping enforced at the query layer on
  every tenant-owned table — this is the single most important thing to get right given §8.
  Row-level security should be evaluated seriously rather than relying on application-layer scoping
  alone.
- **File storage:** object storage for uploaded Tier B documents, encrypted at rest, access-controlled
  per Engagement.
- **Tier A automation:** background job workers calling out to WHOIS/DNS/SSL/CMS-fingerprinting checks
  (many are simple standard libraries or a small number of free/cheap third-party APIs) — no need for
  a scanning product of our own; this is thin integration work, not novel infrastructure. Domain
  ownership lookups must use **RDAP-era APIs, not legacy WHOIS**: ICANN sunset the legacy protocol in
  January 2025 and hundreds of gTLDs have shut off port 43 (`docs/research/profitability.md`).
- **Report rendering:** HTML → PDF rendering pipeline (e.g. headless browser or a PDF library), driven
  off the same Finding data used for on-screen review, so the PDF is never a hand-maintained parallel
  representation.
- **No credential vault in v1** per §8 — this simplifies the architecture materially; do not build one
  speculatively.

## 11. Success metrics

Tracked from Phase 0 onward, refined per-phase in `roadmap.md`:

- **Activation:** design partner completes a full Audit (all tiers) on a real live deal within their
  first engagement using the product. **Two of those conditions are instrumented and two are not**,
  which matters because every evidence gate in `roadmap.md` rests on this number. The metrics report
  counts orgs with at least one audit and audits marked complete; nothing in the product can see
  whether all three tiers were actually worked, or whether the deal was real rather than the
  consultant trying it on a made-up target. At design-partner scale that gap is closed by asking —
  with two partners the founder knows which audits were real — so this is a metric that is *asked*
  and partially corroborated by instrumentation, in the same category as report usage below rather
  than a number to read off a dashboard. It stops being knowable the moment the population is
  larger than the founder's memory, and that is the point at which it needs rethinking rather than
  re-reading.
- **Retention proxy:** a design partner runs a *second* Audit on a second deal without prompting.
- **Willingness to pay:** stated in Phase 0 discovery calls before any pricing page exists; confirmed
  by conversion once pricing goes live in Phase 1.
- **Report usage:** the generated PDF is the artifact actually sent to the buyer's side (vs. the
  consultant re-doing it in their own format) — ask directly, don't infer.

## 12. Open questions carried forward

- Exact pricing numbers within the hybrid model's ranges (§9) — Phase 0 validation, specifically the
  subscription-vs-per-audit head-to-head test `docs/research/pricing.md` §7 specifies.
- **Addressable population is smaller and less certain than `idea.md`'s headline 200+ figure.**
  `docs/research/market.md` §3 and `docs/research/pricing.md` §2 found DueDilio's own site shows
  "Website Review" as one of six diligence disciplines listed, meaning the technology-DD-specialist
  subset of its 200+ providers is likely well under 100, plausibly under 50 — hitting the $3k/mo
  milestone (~47 customers at blended ARPU, §9) probably requires selling into QoE generalists and
  independent IT consultants as a *new* service line, not just tool-switching existing tech-DD
  providers, which is a more consultative, harder sale than the original framing assumed. Phase 0
  discovery calls should explicitly test both populations separately (`docs/research/pricing.md` §7).
- No purpose-built competitor was found (`docs/research/competitors.md` §1) — the closest things are
  AuditCraft (a boutique *service*, not software, priced $2,500–4,500/audit — a useful price anchor
  for what the underlying work is worth) and Finsider.ai (proves "software sold to QoE/diligence
  consultants" as a business model works, but for financial DD, not technology DD — no evidence it or
  anyone else has moved into technology scope). Revisit this scan periodically; it was one search
  session with several sources blocked (G2, Capterra, Clio — see `docs/research/competitors.md` and
  `docs/research/market.md` method notes), not an exhaustive audit.
  **Refresh (2026-09-21, `docs/research/competitors-2026-09.md`):** the gap thesis still holds
  verbatim, but its durability is revised down to a **12–24 month window**, not indefinite. What
  changed: DueDilio shipped a self-service marketplace platform in 2026 (proving it builds software —
  a provider-workflow tool as a retention feature is its most plausible gap-closer); a buyer-facing
  SMB AI-diligence category formed (DEALPRINT, Bizzed, Devaland, Acquire.com's DD tooling — all
  financial-scope, buyer-GTM); and RapidFire Network Detective Pro (whitelabel IT-scan reports to
  MSPs at ~$200–300/mo) surfaced as the closest shipped analog, one positioning pivot from collision.
  Strategic consequence: AI report generation has commoditized the "automated checks → PDF" layer, so
  **Tier A is the wedge, not the moat** — the defensible core is Tiers B+C structured/attested
  evidence capture, the business-type templates, and the whitelabel consultant workflow.
- Whether Tier C ever gets a credential-handling feature, and under what security architecture, if a
  design partner makes it a blocker.
- Distribution entry point: cold outreach to DueDilio's providers vs. a partnership/listing with
  DueDilio itself (confirmed pure lead-marketplace, no provider tooling of its own —
  `docs/research/market.md` §4) vs. reaching QoE generalists/IT consultants directly vs. another
  channel — tracked in `docs/releases.md`, not a product-spec question. **Update (2026-09-21):**
  `docs/research/promotion.md` now provides a ranked channel list and a 90-day sequence (founder-led
  outreach to the publicly self-promoting SMB QoE firm ecosystem first, ETA-community embedding in
  parallel, newsletters/podcasts next — including a warm DueDilio path via its founder's own
  newsletter, The Business Inquirer). The *decision* stays open pending real reply-rate evidence, per
  `docs/releases.md` §5's gate, but the default execution order is no longer unresearched.
- Whether full whitelabel (custom domain, deeper brand control on the portal) should be unbundled
  into a paid add-on tier (+$30–60/mo, per `docs/research/profitability.md`'s lever #3, with
  comparable agency tools gating it behind a higher tier) or stay bundled — decide once real
  customers exist to segment; grandfather design partners either way.
- Whether trademark-conflict scanning (Tier A) should eventually be automated against a paid search
  API, or stays a manual, consultant-triggered step indefinitely.
- Whether evidence coverage (§6) should ever become a gate rather than a signal — e.g., refusing to
  mark an Audit complete while a Tier B item is rated Green with nothing attached. Currently signal-
  only, for the reasons recorded in §6. The evidence that would change it is a design partner
  shipping a report with an unsupported rating that a buyer's advisory team then challenged.
- Whether 90 days (§8) is the right post-terminal retention default. It's a judgment call, not a
  researched number, and the consultants' own professional-liability or client-contract retention
  obligations may cut against it in either direction — ask in Phase 0 discovery, since a firm with a
  seven-year record-keeping obligation and a firm that wants documents gone at close will both be
  in the target population.
- ~~**Who re-verifies the dated thresholds, and how often.**~~ **Resolved — see §4.6.** The question
  was who holds the standing maintenance commitment created by thresholds that are correct as of a
  date rather than indefinitely, and whether the product should carry a dated policy-status note
  surfaced at audit time (`docs/research/audit-thresholds-2026-09.md` §7.3 proposed the latter).
  Resolved without waiting for evidence because it needed none: nothing a design partner could say
  would change who is able to know these facts, and the cost of being wrong is a report that states
  a superseded rule as current.

  The reasoning that produced the answer, kept because it is what stopped it becoming a banner on
  every item: the dated facts are three different problems. Where a change and its effective date
  are both published, nobody needs to be told anything — the product holds the timetable. Where a
  change is adopted with no effective date, no amount of diligence on our side produces the answer,
  so the consultant's judgement at the audit date is load-bearing and they are told, specifically.
  Where there is no known change at all and only a reading that could go stale, the commitment is
  ours and handing it over is what §2 principle 2 sells against.
- **Whether "the seller will not represent X" should be a first-class input to §6's roll-up.** The
  pattern recurs across unrelated items — terminated-merchant status, DNS control, retrieval of a
  domain's AuthInfo code, booking-platform transferability — and the refusal is consistently a
  stronger signal than whatever the underlying data shows, because it is the party who knows declining
  to stand behind it. Today it is encoded per item, inside individual severity rubrics that rate the
  refusal Red. That works item by item but is invisible to the roll-up as a category: the report cannot
  say "three of these Reds are a seller who would not represent, not something we found". Making it a
  typed input on a Finding is a §3 data-model change with §6 consequences, so it needs a real
  trigger — a consultant hitting it on a live engagement and the report reading wrong — rather than
  tidiness (`docs/research/audit-thresholds-2026-09.md` §7.7).
- Whether a firm should be able to browse its own Vendor Term Profiles (§3) as a library in their own
  right — a "what do we know about Toast" view — rather than only in the context of the audit item
  that recalls them. Recorded as open, not planned: there is no evidence for it, since no design
  partner has run an audit and the demand for a cross-engagement vendor view is assumed rather than
  observed. It is also where the reference-only boundary is hardest to hold, because a library invites
  reuse of readings detached from the Engagement and date that are the whole reason they are
  trustworthy. Wait for a consultant to ask for it.
- **Whether a Member should be able to revoke a Client Portal Link they did not create.** Revocation
  is engagement-scoped today, per §3's line, and both readings are defensible with no evidence either
  way: pulling a link back is a safety action that should not have to wait for a partner to be
  reachable, and it also destroys a colleague's delivery to a client mid-engagement, possibly without
  their knowing. Whichever way it resolves, the action is attributable — both the seat that shared
  the report and the seat that withdrew it are recorded (§8) — so the open part is who may act, not
  who did. Wait for a firm to hit it on a live engagement rather than guessing which failure is
  worse.

  This entry previously claimed that attribution already held, when only creation was recorded and
  revocation wrote a bare timestamp. That mattered more than a stale sentence usually does, because
  it was load-bearing for the deferral: the harm described above is a colleague's delivery destroyed
  "possibly without their knowing", and a firm looking at an access trail that reads
  `Revoked · <timestamp>` has nothing to escalate with. The evidence this question waits on could
  not have arrived. Recorded here rather than quietly corrected, because the failure worth
  remembering is not the missing column — it is that deferring a decision to evidence puts a
  standing obligation on the evidence actually being collectable, and nothing re-checked that.
- Which named CRM/deal-tracking connector (if any) to build on top of the §13 webhook/API primitive —
  gated on a paying firm naming the tool they'd actually connect, not guessed in advance (see §13's
  integration decision).

## 13. Phase 4 — depth features (API, webhooks, expanded Tier A automation)

**Status note:** this section is being specified and built ahead of the roadmap's Phase 4 gate
(`docs/roadmap.md` Phase 4 says "re-evaluate against real usage before starting"), per explicit user
direction on 2026-09-21 to proceed — the same kind of override recorded for the Phase 3 Client Portal
(§7). The gate's reasoning stands and is preserved here rather than deleted: without paying firms
using the product, every scope choice below is an evidence-free hypothesis. That risk is mitigated by
deliberately shipping *primitives* (read-only API, signed webhooks, more of the same class of Tier A
check) rather than named-vendor integrations or speculative depth. Placed as §13 (after §12) to keep
the section numbers §1–12 stable, since they are cross-referenced by number across the repo.

### 13.1 Expanded Tier A automated checks

More of the existing class — external, public-information-only, no seller cooperation (§4's Tier A
definition is unchanged; these are content additions inside it, owned by the `audit-methodology`
skill for exact item wording and severity thresholds):

- **Email deliverability & authentication posture** — SPF / DKIM / DMARC DNS records for the business
  domain. Transfer-relevant: a business whose email domain has no authentication records (or a
  misconfigured one) hands the buyer a deliverability problem on day one.
- **Mail provider fingerprint** — MX records identify who hosts the business's email (Google
  Workspace, Microsoft 365, registrar-bundled, self-hosted). A transfer-complexity signal, same
  rationale as the existing DNS/hosting fingerprint.
- **HTTPS hygiene** — does HTTP redirect to HTTPS; is HSTS present. Cheap, public, and a credibility
  detail consultants can point at.

All three follow the existing runner pattern (`src/lib/audit/tierA.ts`): conservative severity
thresholds, notes that state what was observed rather than inferred conclusions. Adding them to
shipped Templates is a template-version event (§5 versioning rules; `docs/releases.md` §3).

**Explicitly not in this batch:** anything requiring a paid third-party API (vulnerability databases,
paid reputation feeds, trademark search — the §12 trademark question stays open), and anything that
would blur Tier A's no-seller-cooperation boundary.

### 13.2 Read-only API (org-scoped keys)

For firms that have adopted CloseCheck and want Audit data inside their own tooling
(`docs/roadmap.md` Phase 4's stated rationale):

- **API keys are per-Consultant-Org, created and revoked by Owners** from a settings surface. Shown
  once at creation, stored hashed at rest (same standard as passwords), with a last-used timestamp
  surfaced so stale keys are visible.
- **Read-only in v1 of the API.** Endpoints expose the org's own Engagements, Audits, Findings, and
  Report metadata — never another org's, enforced by the same RLS scoping as the interactive app, not
  by application code alone (§8's isolation rule applies to every access path, API included).
- **No write API yet.** A write surface multiplies the abuse/blast-radius questions (who can mutate
  findings from outside the app's validation?) for zero evidenced demand. Revisit when a firm asks
  for a concrete write use case.

### 13.3 Webhooks — the integration primitive, not a CRM connector

`docs/roadmap.md` Phase 4 names "CRM/workflow integrations" — but no design partner has named a CRM,
and picking one now would repeat the guessed-feature-list mistake `idea.md` §"The original idea" is
explicit about. Decision: **ship signed webhooks as the primitive** and let the first real firm
integration pull a named connector into scope (tracked as a §12 open question).

- **Events:** `audit.completed`, `report.generated` — lifecycle moments a deal-tracking tool would
  care about. More events only when asked for.
- **Payloads carry identifiers and status, not findings content.** A misconfigured or compromised
  endpoint URL must not become a data-exfiltration path for Tier B document content or finding
  details (§8) — the receiving system uses the id to call back through the authenticated API if it
  wants detail.
- **Signed** (HMAC over the payload with a per-endpoint secret, shown once at creation) so receivers
  can authenticate origin; delivery is best-effort with limited retries, not a guaranteed queue —
  guaranteed delivery infrastructure is not justified at this stage.

### 13.4 What Phase 4 still does not include

- **SOC 2 / compliance certification** — unchanged from §8: gated on a real sales blocker (a firm's
  client contract or partner requirement), not built speculatively.
- **Tier C credential handling** — unchanged standing decision (§4); nothing in this section touches
  it.
- **Named CRM connectors** — see 13.3; the primitive ships, the connector waits for evidence.
