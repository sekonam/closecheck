# The idea

**CloseCheck is technology due-diligence audit software sold to the consultants and firms who
already run acquisition deal flow — not a service sold directly to one-time business buyers.**

This document records where the idea came from, the evidence behind it, why the original framing
was rejected, and the specific reframe that survives. It is the concept brief, not the product spec —
the detailed feature list and roadmap are a separate document.

## Origin

CloseCheck descends from `bizbuysell-main-street-tech-audit`, a candidate researched and scored in
the `webdevprofit` idea-evaluation workspace (`~/dev/webdevprofit`). That workspace ran 90 business
candidates through a structured evidence pipeline; 89 were killed with the reason recorded. This one
survived pre-flight triage and a full five-lens research pass — the only survivor — scoring
**Explore, 46/100**. Full sourcing lives in that workspace at
`ideas/bizbuysell-main-street-tech-audit.md` and `research/bizbuysell-main-street-tech-audit/`.

## The original idea, and why it died as a service business

The original candidate: a pre-purchase technical/website audit for buyers acquiring small
tech-surface-bearing businesses ($200k–2M — restaurants with online ordering, salons with booking
software, digitally-enabled franchise locations), sold directly to the buyer during their
due-diligence window.

**The demand was real and well-evidenced:**

- Quality-of-Earnings (QoE) review — the standard diligence add-on for deals in this band, running
  $8K–15K — **explicitly excludes** "Technology and Cybersecurity Diligence" per a due-diligence
  marketplace's own published scope. The gap is real, not redundant with diligence spend buyers
  already make.
- BizBuySell's own buyer-facing due-diligence checklist has **no technology category at all** — the
  platform actually running this deal flow doesn't cover it.
- A generic 61-item SBA acquisition due-diligence checklist buries "Technology systems and software
  licenses" as 1 of 10 unranked items under Operations & Compliance, alongside HR policy and
  workers' comp — confirming it's a real but low-salience line item, not a headline concern.

**But distribution to the buyer killed it as a standalone service.** The research found the buyer's
core advisory team (attorney, accountant, broker) is assembled *before* due diligence starts, and
those three source each other by reciprocal referral. Business brokers deliberately keep referral
lists to 5–8 core relationships and name "one-way referral pipeline" as the exact failure mode they
filter for — precisely what an unproven solo audit vendor represents to them. No SBA lender referral
list exists for this (there's a clean structural reason: SBA SOP mandates *environmental* review on
real-estate-secured loans, with no equivalent mandate for technology, so lenders have no compliance
reason to build one). Realistic time to a first referred client, cold: **6–12+ months minimum,
optimistically** — and that estimate still assumes solving a bootstrapping problem (producing the
first case-study audits with zero track record) that was never solved.

Distribution scored 6/20 in the rubric against a demand score of 11/25 — better-than-even on demand,
still the deciding factor. The idea was real. The go-to-market, as originally framed, was not.

## The reframe: sell the tool, not the audit

The research surfaced the buyer list for a different product, by name, inside the same evidence:

- **DueDilio**, a technology-diligence marketplace, lists **200+ vetted providers** and has brokered
  $3B in cumulative deal value across 1,300+ projects. Its own "Website Review" category prices at
  $500–5,000 — landing almost exactly on the original candidate's assumed audit price. That's 200+
  independent consultants and firms already doing something like this work, or fielding requests for
  it.
- **Rapid Diligence**, a QoE firm serving this exact deal-size band, reviewed **250+ deals over five
  years and never built a technical/tech-stack review SKU** — despite adding other specialized SKUs
  (an SBA-specific QoE variant) in the same window. That's a revealed-preference signal from the
  best-positioned incumbent: not absent demand, but demand nobody has tooled up to serve
  consistently.

**The reframe converts a hard, cold, buyer-facing distribution problem into an easier,
provider-facing one.** Instead of a solo operator trying to break into a referral network built to
exclude unproven one-way vendors, CloseCheck sells structured audit software to consultants and firms
who already have the deal flow, the client relationships, and the professional standing — the exact
things the original framing lacked. The distribution objection that killed the service business does
not apply to a tool sold to the people already inside the network.

## What the product actually is

A B2B SaaS for M&A / QoE / IT due-diligence consultants running technology assessments on small
business acquisitions:

- **A structured, repeatable audit workflow**, built on the three-tier methodology already designed
  in the source research (`research/bizbuysell-main-street-tech-audit/build.md`):
  - **Tier A — external, no seller cooperation needed** (domain/registrar ownership, DNS/hosting
    fingerprint, SSL/TLS, CMS version and patch status, Google Business Profile and social account
    ownership, trademark conflict scan). Runnable pre-LOI, even pre-offer.
  - **Tier B — seller/broker-provided documents** (POS contract terms and early-termination
    penalties, online-ordering/booking platform contracts and transferability, payment processor
    account standing, the recurring-SaaS inventory and whether each transfers or must be rebuilt).
  - **Tier C — live access verification** (actual login to hosting/CMS/POS/booking/GBP/socials, a
    data-export test). Highest friction, often deferred pre-LOI.
- **Report generation** — a client-ready deliverable (traffic-light executive summary plus tiered
  findings) the consultant can hand to their buyer, not a raw checklist.
- **A client-facing portal** so the acquisition buyer can review findings directly, without the
  consultant re-typing anything.
- **A template library by business type** — restaurant POS/ordering stacks, salon booking systems,
  franchise-mandated tech stacks, general e-commerce — so a consultant isn't building the checklist
  from scratch for every deal type.

## Who pays

Independent technology-diligence consultants, small QoE/M&A advisory firms, and providers already
listed in marketplaces like DueDilio — people who currently either turn away technology-assessment
requests, do them ad hoc with no repeatable process, or have never been asked because nobody made it
easy to offer. Not the acquisition buyer directly, and not the business broker (though a broker
white-labeling this to add "technology review" as a value-add is a plausible secondary buyer, not
the primary one).

## What is not yet decided

This document records the concept and its evidentiary basis. It does not yet define the MVP feature
set, pricing, tech architecture, or roadmap — those are separate documents to follow. In particular,
still open:

- Whether to reach the 200+ DueDilio-listed providers directly (cold, but a *much* smaller and more
  homogeneous list than acquisition buyers), or find another entry point.
- Pricing model — per-seat subscription, per-audit usage fee, or a hybrid.
- Whether the client-facing portal is core to v1 or a later addition.
