# Phase 0 — design partner discovery

**Nothing in this directory has been sent to anyone.** These are materials. Contacting real
consultants is the founder's action, and no part of it has been performed — no message sent, no
prospect list built against real people, no organisation contacted. That line is deliberate: the
population here is small and refers internally, so a clumsy first contact is expensive in a way that
a clumsy first draft is not.

---

## Why this directory exists

`roadmap.md` Phase 0 is the first phase and the least done. Every later phase's exit criteria are
gated on evidence from real consultants, and the build ran ahead of that gate — the top of the
roadmap says so in as many words. These four documents are what Phase 0 needs that is not a
conversation, prepared so the conversations can start.

## The exit criteria, stated exactly

From `roadmap.md` Phase 0, unedited in substance:

1. **At least 2 design partners committed with a real upcoming deal to test on.**
2. **No discovery call surfaced a reframe-invalidating objection** — the roadmap's own example being
   *"I'd never trust a third-party tool with this regardless of credential handling."*

Both matter and they fail differently. The first is a target you work toward and can measure. The
second is a hazard you can only find by asking questions capable of producing it, which is why
`discovery-guide.md` §5 exists and why it should not be skipped on calls that are going well.

The phase's supporting deliverables — 10–15 calls split across two distinct populations, the
head-to-head pricing test, a report output to react to, and validation of the one-template MVP
choice, the pricing direction and the no-credential-handling decision — are in the roadmap and are
not restated here.

## The four documents

| File | What it is | When it is used |
|---|---|---|
| `outreach.md` | Copy for LinkedIn, cold email and the free-audit hook, with what each assumes about its channel | To book the calls |
| `discovery-guide.md` | The interview guide, built to falsify rather than to sell | On the call |
| `design-partner-terms.md` | What a design partner gets and gives, including the awkward parts | After a call goes well |
| `README.md` | This page | First |

They run in that order, and each hands something to the next. `outreach.md` deliberately refuses to
name a price, because the pricing head-to-head in `discovery-guide.md` §3 is the one measurement
Phase 0 gets and anchoring beforehand destroys it. `discovery-guide.md` ends by asking what to write
down within the hour, and two of those fields — the price where hesitation started, and the sentence
that landed — are the raw material that should eventually replace the reasoning-derived copy in
`outreach.md`. `design-partner-terms.md` is what you send when §4 of the guide produces a real yes,
and it is written to be read by the partner rather than about them.

## What is true about the product, as of writing

Stated here so none of the other three documents has to soften it, and so a reader can check them
against one place:

- Four checklist templates exist, at version 6, across restaurant, salon/booking, franchise and
  general e-commerce.
- The audit loop works: tiered checklist, structured capture per item, evidence upload, severity
  roll-up, a whitelabeled PDF report, and a revocable client portal link for the buyer.
- **It has never been run on a real deal.**
- **There is no paying customer.**
- **There is no production deployment.**
- **Document storage is still local disk.** `docs/security-posture.md` §4 describes this as having
  been its largest gap and now a smaller, differently-shaped one: the S3-compatible backend is
  written and has never stored a real byte, and local storage gives whatever encryption the volume
  provides, with no redundancy.

If any of that changes, this list is the thing to update first, because the other three documents
lean on it.

## What the research does and does not establish

`outreach.md` and `discovery-guide.md` trace their claims to `docs/research/`. Several things those
documents could not establish are worth knowing before a call, because it is tempting to state them
with more confidence than they carry:

- **No consultant has been found, in their own words, saying they need this.** `market.md` §1 found
  the visible market dominated by generic Excel and Word templates, but the first-person practitioner
  account is explicitly named there as the single most valuable unresolved question — the sources
  likeliest to hold one were unreachable in that session. §1 of the discovery guide is the cheapest
  way to resolve it.
- **The buyer population's size is not known.** DueDilio's "200+ providers" spans every diligence
  discipline, not technology specialists; `pricing.md` §2 assumes technology-focused providers are
  10–25% of it — an assumption, with no published breakdown found. IBBA does not publish a membership
  count. AM&AA's 1,100+ is general M&A professionals. ACG's 100,000+ is the wrong deal band.
- **Whether LinkedIn beats cold email here is reasoned, not measured.** `distribution.md` §2 flags
  its own conclusion as an assumption and proposes the direct test; `spec.md` §12 records the
  distribution entry point as open pending real reply-rate evidence. `outreach.md` is written to
  produce that number, not only to book calls.
- **Whether a competing product exists is unresolved.** `market.md` §2 could not check the two
  sources most likely to catalogue one, and records that as a coverage gap rather than a negative
  finding.

## What happens after

If both exit criteria are met, Phase 1 has its design partners and the roadmap's sequencing resumes.
If the second criterion fails — if the trust objection turns up unprompted more than once — that is
the reframe failing, and finding it here is the cheapest place it can be found. `roadmap.md` says
this phase exists specifically to find that out before Phase 1 is funded; the unusual position now is
that Phase 1 was built first, which raises the cost of that answer without changing whether it is
worth asking.
