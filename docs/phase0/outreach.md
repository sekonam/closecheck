# Phase 0 — outreach copy

**What this is.** Copy the founder can send to reach the 10–15 discovery calls `roadmap.md` Phase 0
asks for, in variants matched to the channels `docs/research/distribution.md` found actually support
this population.

**Nothing here has been sent.** Sending is the founder's action; see this directory's `README.md`.

**The honesty constraint, stated once and applied throughout.** CloseCheck has four templates at v6,
a working audit loop, a whitelabeled PDF report, and a client portal. It has **never been run on a
real deal**, has **no paying customer**, has **no production deployment**, and its document storage
is still local disk rather than object storage (`docs/security-posture.md` §4). None of the copy
below may imply otherwise, and none of it does. This is not modesty — a consultant who discovers on
the call that "built" meant something softer than they assumed has learned that your descriptions
need discounting, and that is expensive to undo in a population this small.

---

## The channel evidence, briefly

`docs/research/distribution.md` reaches three conclusions that shape everything here:

- **DueDilio is not a list.** Its provider network page shows first name, last initial, specialty and
  region only, and the site states this is deliberate. The "200+ providers" figure is evidence the
  category and price point are real; it is not contactable. Do not budget time trying to work around
  this.
- **LinkedIn is the better-reasoned default over cold email** for M&A/QoE consultants, because it
  reaches a named individual rather than a firm inbox. That research flags this as `ASSUMPTION` —
  reasoned from the population's behaviour and from how the associations themselves market to it, not
  from a verified case study, which it could not find.
- **The credible hook is a free Tier A audit, not a pitch.** These buyers make their living selling
  diligence findings, so a finding they could hand a client is a stronger opening than a description
  of software.

**And the open question this outreach is partly an instrument for.** `spec.md` §12 records the
distribution entry point as unresolved, pending *real reply-rate evidence*. `distribution.md` §2
proposes the cheapest way to get it: run roughly 20 LinkedIn messages and 20 cold emails against the
same quality of list and compare reply rates directly — a one-week experiment, not a research
problem. **Split the first batch deliberately and count.** The point of these variants is not only to
book calls; it is to produce that number.

---

## Variant 1 — LinkedIn, to someone who already advertises technology diligence (Population A)

Assumes: the recipient's profile or firm site names technology/IT due diligence as a service, so the
qualifying fact is public and can be cited. This is the primary motion.

> Hi [Name] — your profile lists technology diligence alongside the QoE work, which is a combination
> I have not found much of.
>
> I am building a structured audit tool for exactly that workstream — the external checks you can run
> pre-LOI, the contract and transferability items that need seller documents, and the live-access
> checks you do yourself. It is early: it has never been run on a real deal, and I am looking for two
> or three consultants willing to break it on one.
>
> Before any of that, I would rather just hear how you run this today and what you hand the client.
> Would 20 minutes be worth it? I have no pitch prepared — I have a list of questions and a sample
> report you can tell me is wrong.

Why it is shaped this way: it cites a specific, public, verifiable fact about them rather than
opening on the product; it states the product's actual maturity in the second paragraph rather than
burying it; and it asks for their process rather than offering a demo, which is what section 1 of
`discovery-guide.md` needs.

## Variant 2 — LinkedIn, to a QoE generalist or IT consultant who does not offer this (Population B)

Assumes: the recipient does diligence work or IT consulting but technology diligence is not a named
line item. `docs/research/pricing.md` §2 concludes this is the population the revenue model actually
needs, and that it is a harder sale — adopting a service line, not switching tools.

> Hi [Name] — you run QoE work in the small-deal band, and I am trying to find out whether something
> is missing from it or whether I have invented a problem.
>
> Financial QoE scope in this band generally excludes technology and cybersecurity diligence, and the
> standard buyer-facing checklists mostly do not have a technology category at all. So either buyers
> are not asking, or somebody is absorbing it informally.
>
> I am building a tool for that gap and would rather find out it is not a gap now than later. Would
> you have 20 minutes to tell me which it is? Genuinely a research call — there is nothing to buy,
> and the product has not been used on a real deal yet.

Why it is shaped this way: Population B has no reason to care about a better tool for something they
do not sell, so the opening has to be about the gap and not the software — and the exclusion it
cites is sourced (`idea.md`, from a due-diligence marketplace's own published scope, and BizBuySell's
buyer checklist having no technology category). It also makes the call cheap to accept by being
honest that there is nothing to buy, which is true.

## Variant 3 — cold email, for the A/B test

Assumes: a findable firm address, usually `info@` or a named partner. Weaker on principle, because
`distribution.md` expects it to underperform reaching a named individual — which is exactly why it is
worth sending a matched batch rather than assuming.

> Subject: how do you handle the technology side of a QoE engagement?
>
> [Name] — I am building audit software for technology due diligence on small acquisitions, in the
> band where a QoE runs $8–15k and explicitly excludes technology and cybersecurity scope.
>
> It is pre-launch: four checklist templates, a client-ready report, a portal for the buyer, and no
> real deal has been through it. I am looking for two or three consultants to run one and tell me
> where it breaks.
>
> If that is interesting, I would rather start by hearing how you do it today. 20 minutes?
>
> If not, no follow-up — I am working a short list, not a campaign.

Why it is shaped this way: email gets less benefit of the doubt, so it front-loads the specific deal
band and the scope gap; it states the product's maturity in the second line; and the closing promise
of no follow-up is there to be kept. On a list this small, one person who feels pursued is a
reputational cost across a network where these people refer each other.

## Variant 4 — the free Tier A audit as the opening

Assumes: you have run a real Tier A audit on a genuinely listed business-for-sale and have a report
to attach. `distribution.md` names this the strongest hook in the primary motion. It costs the most
per prospect and should be used on the best-qualified names.

> Hi [Name] — I ran a technology audit on [specific listed business], unprompted, as a way of showing
> what I am building rather than describing it. Report attached: registrar and DNS ownership,
> certificate and domain expiry against the closing window, email authentication posture, and the
> platform-transferability questions that need the seller's contracts.
>
> No pitch. If it is useful for a deal you are working, I will run one on a target you are actually
> diligencing, also free.
>
> The honest state of it: the software generates this, but no consultant has used it on a live
> engagement yet, and finding the two or three who will is what I am doing at the moment.

Why it is shaped this way: the report does the arguing, so the message can be short; and the last
paragraph is the one that must not be cut, because the attachment makes the product look more
finished than it is and the copy has to correct for that.

---

## What to keep true

- **Never write "used by" or imply a customer.** There is none.
- **Never imply a deployment.** There is no production environment; a design partner's first run
  will involve you.
- **If asked about security, send `docs/security-posture.md` rather than summarising it.** It is
  written to be sent, it states its own gaps — including that document storage is still local disk —
  and paraphrasing it is how a claim drifts from what the code does.
- **Do not name a price in outreach.** The pricing conversation is a head-to-head test on the call
  (`discovery-guide.md` §3); anchoring it beforehand destroys the only measurement Phase 0 gets.

## What to count

Per batch, and per channel, so the `spec.md` §12 distribution question gets an actual answer:

| | Sent | Replied | Call booked | Population |
|---|---|---|---|---|
| LinkedIn | | | | A / B |
| Cold email | | | | A / B |
| Free-audit hook | | | | A / B |

Reply rate is the number. `distribution.md` suggests treating sustained sub-5% reply across the first
40–60 contacts as the trigger to reweight toward the IBBA Supplier Directory listing — which it
prices at $595–895/year from a brochure whose URL is dated 2021, and flags that the current figure
needs confirming with IBBA directly before anyone budgets against it.
