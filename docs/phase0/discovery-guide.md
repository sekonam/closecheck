# Phase 0 — discovery call guide

**What this is.** The interview guide for a discovery call with an M&A/QoE consultant or independent
IT diligence provider, written to test `roadmap.md` Phase 0's exit criteria rather than to sell.

**What this is not.** A demo script. Phase 0 exists to find out whether the reframe in `idea.md`
converts to willingness-to-pay *before* more is built, and the roadmap names the specific risk it is
managing: that consultants turn out to be as referral-gated and outreach-resistant as the acquisition
buyers who killed the original framing. A call that ends with the prospect enthusiastic and the
interviewer unable to say what would have changed their mind has produced nothing.

**The two exit criteria this guide serves** (`roadmap.md` Phase 0):

1. At least **2 design partners committed with a real upcoming deal** to test on.
2. **No call surfaced a reframe-invalidating objection** — the roadmap names the example:
   *"I'd never trust a third-party tool with this regardless of credential handling."*

Note the asymmetry. The first is a positive result you have to earn. The second is a negative you
have to go looking for, and a guide that never asks a question capable of producing it cannot report
it. Section 5 exists for that reason alone.

---

## Before the call: which population is this?

`roadmap.md` Phase 0 requires 10–15 calls split across **two distinct populations, not treated as
one list**, and the split is load-bearing rather than tidy. `docs/research/pricing.md` §2 estimates
that technology-focused providers are perhaps 10–25% of DueDilio's 200+ — **an assumption, not a
published breakdown**, giving roughly 20–50 in-category providers — from which the customer counts
in §2 of that document are not reachable. Hitting them requires the second population.

- **Population A — already sells technology diligence.** The pitch is *switch your tooling*. They
  have a process; the question is whether this one is better than theirs.
- **Population B — QoE generalists, fractional CTOs, independent IT consultants who do not currently
  offer technology diligence as a line item.** The pitch is *add a service line*. Harder: it asks
  them to sell something new, not to change how they deliver something they already sell.

Record which population every call belongs to before it starts. The same answer means different
things from each, and `pricing.md` §7 expects the pricing conversation itself to distinguish them.

---

## 1. How they work today (10 minutes)

Open here, not on the product. The purpose is to find out whether the problem exists in their words
before the product suggests it to them.

- Walk me through the last acquisition you diligenced where technology mattered. What did you
  actually look at?
- Who asked for it — the buyer, the lender, or you raising it?
- What did you use to run it? *(Listen for: a spreadsheet, a Word template, nothing, a junior person.
  `docs/research/market.md` §1 found the visible market for this is dominated by generic Excel/Word
  templates — Smartsheet, Flevy, Slidesdocs, ConsultingCheck — but that is search-derived evidence,
  and no first-person practitioner account was reachable in that research. This question is the one
  that resolves it. A single consultant describing their actual process is worth more than that
  entire section.)*
- What did you hand the client at the end? Ask to see the shape of it if they will show you.
- How long did it take, and how much of that was work you would rather not repeat?

**What a "no" looks like here, and it counts:** they do not look at technology at all, nobody asks,
and the deals close fine without it. Record that verbatim. Several of those is a finding about the
category, not a run of bad calls.

## 2. Money (10 minutes)

- What do you charge for a diligence engagement, and how is it structured — fixed fee, hourly,
  percentage?
- Is technology part of that fee or a separate line?
- Roughly how many of these do you run a year? *(`docs/research/pricing.md` works from 2–50
  audits/**year**, and the whole pricing model turns on that being per year rather than per month. If
  their answer is far outside that range, the model is wrong for them and that is worth more than a
  polite agreement.)*
- What software do you already pay for monthly in this practice, and what does it cost?

## 3. The pricing head-to-head (10 minutes) — the single most important section

`docs/research/pricing.md` §7 names one number as the thing to validate before any billing
architecture is built: **whether this buyer will pay a recurring fee at all for a tool used a handful
of times a year, tested head-to-head against a pure per-audit alternative.** Everything else in that
document — price point, customer counts, churn assumptions, LTV:CAC — is downstream of it.

So pitch both, side by side, in the same breath, and let them choose. Do not lead with the one you
prefer.

> **Option A — subscription.** A monthly fee around $29–39 for one seat that keeps the account
> useful between deals: the template library, your branding on the reports, and unlimited Tier A
> runs. Two or three full audits included a year, and beyond that you pay per audit.
>
> **Option B — per audit.** Nothing monthly. You pay only when you run a full audit.

Then:

- Which of those would you actually buy?
- At what price does each stop being obviously worth it?
- If you went three months without a deal, what happens to Option A in your head?

**Record the number where hesitation starts, not just the choice.** `spec.md` §9 carries a specific
open band: the per-audit overage figure was revised from $49–79 to **$99–149** on the reasoning that
the lower band captures only 1.5–10% of the consultant's own $500–5,000 engagement fee while
comparable tools capture ~6–16%. `spec.md` labels the higher number *"a hypothesis to validate, not
a decision to skip validating."* This section is where it gets validated or killed. Quote the higher
band to at least half the calls and watch what happens.

**Also unvalidated and worth naming here:** `spec.md` §9's whole table is prefaced *"numbers are
placeholders for Phase 0 validation, not commitments."* The annual-credits option (roughly $588/year
including 6 audits, further audits around $69) was promoted to lead offer on churn-benchmark
reasoning, not on anything a consultant said. If the call has room, offer it as a third option and
see whether annual commitment reads as a discount or as a risk.

## 4. The deal (5 minutes)

This is the section that produces or fails to produce exit criterion 1.

- Do you have a live or upcoming deal in the next 60 days where this would apply?
- Would you be willing to run it through an early version, free, and tell me where it fails?
- What would you need to see first?

**Be precise about what "committed" means** and do not soften it: a named deal, a rough timeframe,
and a yes. "That sounds useful, send me something" is not a design partner and must not be recorded
as one. Two soft yeses look like exit criterion 1 and are not.

## 5. What would make you refuse (10 minutes) — do not skip or soften this

The roadmap's second exit criterion can only be met by asking questions that could fail it. Ask
these even when the call has gone well — especially then.

- **The trust question, asked directly.** *This would mean your client's seller's contracts and
  merchant statements sitting in a system I run. Is there a version of that you would never agree to,
  regardless of what I tell you about security?* The roadmap names the answer that invalidates the
  reframe — *"I'd never trust a third-party tool with this regardless of credential handling"* — and
  the only way to hear it is to make it easy to say. If they hedge, push once: *is that a "show me
  the controls" or a "no, ever"?* Those are different answers and only one of them is fatal.
- **The credential question.** Tier C live-access checks are performed by the consultant in their own
  browser and recorded as an attestation — the product accepts, stores and proxies no third-party
  credentials at all, by standing decision (`spec.md` §4). *Is that a relief, or does it make the
  tool useless to you?* `roadmap.md` Phase 0 explicitly lists validating whether this decision "is
  actually a blocker for anyone real."
- **The brand question.** The report carries your name, not mine (`spec.md` §2, principle 4). Does
  using someone else's tool under your own brand create a problem — with clients, with your E&O
  insurer, with a partner?
- **The template question.** The MVP choice was one template, Restaurant with online ordering
  (`spec.md` §5). *Is that the deal type you actually see, or is it the wrong one?* All four
  templates now exist, which makes this easier to ask and easier to get a real answer to: show them
  the list and let them say none of these.
- **The obvious one, asked last:** what would have to be true for you to not bother with this?

## 6. Close

- Who else should I be talking to? *(`docs/research/distribution.md` finds the buyer population is
  small and identifiable only through manual list-building — association directories, LinkedIn,
  firms publicly advertising the service — since DueDilio's provider list is anonymised by design.
  A referral from inside the population is worth more than any list-building hour.)*
- May I come back to you when there is something to show?

---

## What to write down, within an hour of the call

Memory reorganises a call toward the outcome you wanted. Write these before it does:

1. **Population A or B.**
2. **Their audits per year**, as a number.
3. **Subscription or per-audit**, and the price where hesitation started — both options.
4. **A real deal in 60 days: yes/no**, and if yes, what it is.
5. **Any refusal, quoted verbatim.** Not summarised. The exit criterion is about whether a
   reframe-invalidating objection was *surfaced*, and a paraphrase cannot be assessed later.
6. **What you said that they reacted to** — the sentence that landed, if one did. This is the raw
   material for the outreach copy in `outreach.md`, which is currently written from research rather
   than from anything a consultant has said.

## What would make this phase fail honestly

Worth deciding in advance, so a run of warm calls does not get read as validation:

- Ten calls and no live deal in 60 days from anyone. The product may be real and the timing
  unreachable.
- Consistent preference for per-audit with no willingness to pay anything recurring. That does not
  kill the product; it kills `spec.md` §9's hybrid and most of its unit economics, which
  `docs/research/profitability.md` already flags as dependent on the higher overage band.
- Two or more unprompted versions of the trust objection. That is the reframe failing, and it is the
  outcome this phase was funded to find cheaply.
