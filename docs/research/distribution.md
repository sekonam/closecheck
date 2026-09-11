# CloseCheck — distribution research

**Date: 2026-09-11. Scope: is the "small, named, findable buyer list" reframe in `docs/idea.md` real,
and if so, what does it cost to reach the first 10-20 paying firms?**

This picks up the single open thread the source workspace's distribution pass on
`bizbuysell-main-street-tech-audit` could not close: DueDilio's scope/network pages were
CAPTCHA-blocked in that session, so "200+ vetted providers" was recorded as a headline number, not
a verified contactable list (`webdevprofit/research/bizbuysell-main-street-tech-audit/distribution.md`,
lines 273-276). That page loaded cleanly this session. The answer changes the shape of the whole
reframe.

---

## 1. Is the DueDilio provider list actually contactable? — NO. This is the load-bearing finding.

`duedilio.com/our-network/`, retrieved 2026-09-11, direct fetch, primary source.

DueDilio's public network page displays teaser provider cards — first name + last initial,
specialty, and US state/region only:

> "James K. — Quality of Earnings · Financial Due Diligence · Manufacturing & Distribution — FL,
> USA" / "Thomas B. — M&A Attorney · LOI & Purchase Agreement Review · 300+ Deals — NY, USA" /
> "David R. — Deal Coaching for First-Time Buyers · Search, LOI & Negotiation Strategy — TX, USA"

No last name, no firm name, no website, no LinkedIn, no email, no phone. The site's own FAQ states
this is deliberate:

> "Firm names and identifying details stay confidential until you choose to engage, which keeps the
> marketplace fair and ensures providers compete on merit." `EVIDENCE`, direct quote.

The homepage's own pitch for signing up confirms the same thing applies even to a free account —
you get to browse more of the same anonymized cards, not real identities:

> "Create a free account to explore DueDilio's vetted network — provider specialties, credentials,
> and deal experience — before you pay anything." `EVIDENCE`, direct quote,
> `duedilio.com` homepage, retrieved 2026-09-11.

There is no `/providers`, `/network`, or `/experts` public directory URL (all 404). "Our Network" is
the only public-facing page, and it is intentionally de-identified. `duedilio.com/hire-by-specialty/`
lists "Technology DD" as a category but again shows only aggregate descriptions, no names.

**`INFERENCE`: the "200+ vetted providers" figure is real (DueDilio states it and the source research
independently corroborated the $3B/1,300-project traction) but it is not a usable cold-outreach
list.** A vendor cannot browse DueDilio and come away with 200 names, firms, and emails to cold-email
or LinkedIn-message. To identify even one real provider, DueDilio itself would have to introduce
them — which only happens on the buyer side of a paid engagement, not to an outside SaaS vendor
pitching the provider a tool. This is a structural anti-disintermediation design, not an oversight:
DueDilio's business model depends on keeping providers anonymous until a fee is paid, precisely so
providers can't be poached around the marketplace. That same design blocks a tool vendor from using
the marketplace as a lead list.

**This overturns the core premise in `docs/idea.md`** ("the buyer list for a different product,
[found] by name, inside the same evidence" — it was not found by name; it was found by headline
count). The "small, named, findable list" claim does not survive contact with the actual site. The
buyer population is small (plausibly true — DueDilio is one of very few marketplaces of this kind)
but it is not *named* or *findable* through DueDilio itself.

**What is still true, and matters:** DueDilio proves the buyer category exists, prices it
($500-$5,000 for "Website Review," $4,000-$10,000 for "Software Code Review"), and puts a number on
it (200+ providers, one marketplace). It just doesn't hand you the list. The 200+ providers on
DueDilio are a *reachable-in-principle, unreachable-in-practice-via-DueDilio* population — they have
to be found some other way (professional associations, LinkedIn search, direct discovery of firms
that advertise "technology due diligence" as a service on their own websites).

---

## 2. Cold outreach economics: B2B SaaS to professional-services buyers

This is a different motion than consumer/SMB cold email, and the difference matters for CloseCheck
specifically:

- **The buyer is a professional who already fields cold pitches from software vendors as part of
  their job** (QoE firms, M&A attorneys, and consultants are pitched deal-sourcing tools, data-room
  software, and workflow SaaS constantly) — cold outreach here is not novel or rude, it is the
  background noise of the category. That's a double-edged fact: it means the channel isn't taboo,
  but it also means the inbox is crowded and a generic pitch drowns.
- **LinkedIn, not email, is the primary cold channel for this population.** M&A/QoE consultants are
  disproportionately LinkedIn-active (it is where they source deal flow, referral relationships, and
  thought-leadership visibility — the same reason IBBA's own sponsorship guide reports "90,000 total
  reach on Facebook alone" but leads with LinkedIn-style professional positioning language
  throughout its pitch to sponsors). A LinkedIn connection request + short message referencing a
  specific, findable fact about the recipient's practice (their listed specialty, a firm they work
  with, a recent post) has materially higher reply rates in professional-services B2B than cold email
  to a generic firm inbox, because it reaches the named individual, not `info@`.
- **The credible entry point is a free, named audit, not a sales pitch.** Because these buyers make
  their living selling diligence findings, "hire us to prove we can generate a finding you'd pay to
  hand a client" is a stronger hook than "buy our software." A free Tier-A report (the no-seller-
  cooperation tier already designed in the source build doc) run on a real target the consultant is
  already diligencing is the plausible unscalable-motion hook — see the first-ten plan below.
- **`ASSUMPTION`, flagged as such:** this workspace could not find a dated, citable case study this
  session of a comparable narrow-professional-population B2B SaaS (e.g., practice-management or
  workflow tools sold to accountants, appraisers, or M&A boutiques) breaking down its exact channel
  mix and CAC with sources — the web-search tool's query budget was exhausted mid-session and general
  web search (Google/DuckDuckGo) returned a consent wall and a CAPTCHA respectively on direct fetch
  attempts. The LinkedIn-over-email and free-audit-hook conclusions above are reasoned from the
  evidence gathered directly (IBBA/AM&AA sponsorship materials, DueDilio's own positioning, and the
  structural nature of the buyer population) rather than from a verified third-party case study. The
  cheapest resolution: run 20 LinkedIn outreach messages and 20 cold emails in parallel to the same
  quality of prospect list and compare reply rates directly — this is a one-week experiment, not a
  research problem.

---

## 3. Professional associations as a channel — IBBA, ACG, AM&AA

All three run paid vendor/sponsor programs. None gate them behind exclusive access — anyone can pay
to get in front of the membership. Sizes and prices, verified directly:

### IBBA (International Business Brokers Association)
- Self-describes as the world's largest non-profit for business intermediaries; exact membership
  count not published on its public about page (`ibba.org/about/`, retrieved 2026-09-11 — no figure
  given). `EVIDENCE` (absence of figure, not a negative claim about size).
- **Runs an existing "Supplier Directory" with a live "Technology" category** —
  `ibba.org/resource-center/supplier-directory/`, retrieved 2026-09-11 — subcategories:
  *Accounting Software, Computer Hardware, CRM Software, Data Services, Payroll Software, Valuation
  Software.* Currently listing example vendors including Tupelo, CoolLife.io, Deal Studio, BizWorth,
  BizMiner, ValuSource — none of these are technology-*due-diligence* audit tools specifically; the
  category is open and CloseCheck fits it. `EVIDENCE`, direct fetch.
- **Pricing (from IBBA's own PDF, `IBBA-Supplier-Directory-Brochure-and-Form_V4-1.pdf`, file dated
  2021 in its URL path — confirm current price before committing):**
  - Basic Listing: **$595/year** — company name, address, phone, website link.
  - Premium Listing: **$895/year** — adds logo, contact name, up to 6 uploads (images/flyers/video).
  - 50% off each additional category listing.
- **Sponsorship guide pricing** (same brochure set, `ibba-sponsorship-opportunities.pdf`, also 2022-
  dated URL — confirm current price):
  - Feature article on IBBA.org: $950 (3 for $2,565, 6 for $4,560).
  - Website display ad: $750/quarter up to $2,400/year (1 category).
  - E-magazine (5,000+ recipient quarterly digital publication) article: $750; display ad $750-$2,000
    per issue.
  - Podcast sponsorship: $1,000/episode, $5,000/season (6-8 episodes).
  - Bundled packages: $4,000-$17,500/year for multi-channel exposure.
  - Traffic claimed: ibba.org draws "over 30,000 unique pageviews each month." `EVIDENCE`, direct
    fetch of IBBA's own PDF.
  - **`ASSUMPTION`**: these are list prices from a document 4-5 years old as of 2026; actual current
    pricing needs a call to IBBA (888-686-4222 / admin@ibba.org) before budgeting against it.

### AM&AA (Alliance of Merger & Acquisition Advisors)
- **"More than 1,100+ professionals," spanning 25 countries, representing deals "$5 million to $500
  million"** — `amaaonline.com`, retrieved 2026-09-11. `EVIDENCE`, direct fetch. This deal-size band
  skews above CloseCheck's original $200k-2M anchor but overlaps the QoE/tech-DD consultant
  population the reframe actually targets (those firms serve a range of deal sizes, not just
  main-street).
- Runs "two industry conferences each year" (summer and winter) with "hundreds of M&A professionals."
  Has a `/strategic-partners/` page and an advertising/sponsorship page
  (`/advertising-lander-old/`) — contact-gated, no public pricing found this session.
- Has a member directory (`amaa.wildapricot.org/directory`) — Wild Apricot-hosted, almost certainly
  login-gated (standard for that platform); not checked further this session, but this is the kind
  of association member list that (unlike DueDilio) plausibly *does* expose real names and firms to
  logged-in members, which membership itself would buy access to. Flagged as the next cheap check.

### ACG (Association for Corporate Growth)
- **"Over 100,000 M&A professionals" across "61 local markets worldwide"** — `acg.org`, retrieved
  2026-09-11. `EVIDENCE`, direct fetch. This is a much bigger, more PE-and-larger-deal-skewed
  population than AM&AA or IBBA; sponsorship is real (flagship events include ACG DealMAX) but
  pricing is contact-gated (`kgregorio@acg.org` for national-level sponsorship) — no public figure
  found. `INFERENCE`: at this scale, national ACG sponsorship is very likely priced for enterprise
  vendors (five figures and up), but *local chapter* sponsorship (ACG operates by regional chapter,
  and many chapters sell $500-$3,000 local event sponsorships independently of national) is the
  plausible entry point, not the national program. Not verified this session — chapter-level pricing
  pages were not individually checked.

**Verdict on associations**: IBBA's Supplier Directory is the standout finding — a live, open,
already-populated "Technology" category, priced, at $595-$895/year, that CloseCheck fits into
directly, sitting in front of an audience skewed toward exactly the main-street/SMB deal band the
original candidate targeted. AM&AA is the better demographic fit for the *tech-DD consultant*
population specifically (deal-size range matches where QoE/tech-DD firms like DueDilio's providers
actually work) but its channel costs are opaque and need a phone call to resolve. ACG is too big and
too PE-skewed to be a first-year priority.

---

## 4. Content/SEO angle — narrow B2B query, AI Overview exposure unverified this session

`ASSUMPTION`, clearly flagged: this session's web-search tool budget was exhausted (200/200 used
across the broader conversation) before this question could be answered directly, and direct fetches
of Google search results were blocked by a consent-wall redirect (EU/Poland-geolocated fetch
infrastructure), so no live SERP for "technology due diligence checklist" or "IT audit for business
acquisition" was actually observed this session — **this question is open, not answered.**

What can be said without a live SERP check:
- The prior research pass already established that DueDilio itself ranks and monetizes adjacent
  terms ("quality of earnings," "technology due diligence") with priced service pages, which is
  itself evidence the category has enough commercial search intent to be worth a marketplace's SEO
  investment. `INFERENCE` from `market.md`'s DueDilio findings, not fresh evidence.
- Narrow B2B professional queries (as opposed to broad consumer "how do I..." queries) are
  `INFERENCE`, not verified this session, generally less likely to trigger Google's AI Overview
  because AIO disproportionately activates on high-volume informational queries; low-volume,
  narrow-intent B2B terms often don't cross the volume/pattern threshold that triggers it. This
  tracks with what this workspace has found in other categories (AIO exposure varies hugely and
  correlates with query breadth), but it has not been checked for this specific term.
- **The cheapest resolution**: a single manual browser search (not tool-mediated) for "technology due
  diligence checklist" and "IT due diligence acquisition" would resolve both the AIO-exposure question
  and give a real top-10 competitor list in five minutes. This is a five-minute check that should
  happen before any SEO commitment is made, and it was not completed this session — record it as the
  first thing to do next, not as a finding.

---

## 5. Partnership with DueDilio — plausible pitch, zero evidence of appetite, one real hook

- **DueDilio runs a "Partner Program"** (`duedilio.com/partner-program/`, retrieved 2026-09-11) but
  it is a **referral-fee program for people who send DueDilio clients** (business brokers, M&A
  advisors, attorneys, CPAs, wealth managers, lenders) — not a vendor/technology-partner program.
  "No referral minimums, no marketing obligations" and a one-time $149 platform fee charged to the
  *referred client*, not a partner payout structure. `EVIDENCE`, direct fetch. This program is built
  for people who bring DueDilio deal flow, not for a SaaS tool that wants to sell *into* DueDilio's
  existing provider base.
- **No existing DueDilio tooling for providers was found.** `duedilio.com/join-network/` (provider
  application page) describes vetting criteria (SMB/lower-middle-market experience, references,
  background check) with no mention of software, checklists, or workflow tools offered to accepted
  providers. `EVIDENCE`, direct fetch. This is a genuinely useful fact: **there is no existing
  DueDilio-owned competing tool CloseCheck would be displacing**, which makes a "we'll help your
  providers deliver a more consistent, better-documented technology-DD report" pitch structurally
  non-threatening rather than competitive.
- **Why a formal partnership is still unproven, not just unfound:** DueDilio's revenue model is a
  cut of matched-deal value (the $149 platform fee plus whatever it takes on the provider side of
  larger engagements). A tool that makes providers *faster and more consistent* is plausibly good for
  DueDilio (better-reviewed providers, more repeat engagements, a differentiator DueDilio could market
  — "our providers use structured audit software") — but nothing in the public-facing site suggests
  DueDilio currently positions itself as a technology-enablement layer for its providers, only as a
  matching/vetting marketplace. A white-label or integration deal is a **cold pitch to make, not a
  channel that already exists** — no evidence of appetite, no public precedent of DueDilio doing this
  with any other tool vendor was found.
- **`INFERENCE`**: the more realistic near-term version of "partner with DueDilio" is not a formal biz-
  dev deal (too slow, needs a champion inside a marketplace that has no stated interest in one) but
  simply: become good enough at this that individual DueDilio-listed providers, once found some other
  way (association directories, direct outreach, LinkedIn), independently recommend CloseCheck to
  each other — the same organic mechanism that would make DueDilio itself take notice later. This is
  a second-order outcome of the primary channel below, not a substitute for it.

---

## Realistic channel mix and cost to reach the first 10-20 paying firms

**First ten (unscalable, manual):**

1. Build a target list of 40-60 real, named tech-DD/QoE consultants and small M&A advisory firms —
   *not* from DueDilio (can't), but from: (a) IBBA's own Supplier Directory Technology/Consulting
   categories and its business-broker member firms that publicly advertise "technology assessment" or
   "IT diligence" as an add-on service, (b) AM&AA's public conference speaker/sponsor lists and any
   member firms with public websites naming a tech-DD offering, (c) a direct Google search (once the
   consent-wall issue is worked around, or done manually) for "technology due diligence" + "quality of
   earnings" site operators, (d) LinkedIn search for professionals whose headline/about section
   references "technology due diligence," "IT diligence," or "M&A technology assessment."
2. Run one **free Tier-A audit** (external-only, no seller cooperation needed — the exact tier already
   designed in `build.md`) on a real, currently-live business-for-sale listing, unsolicited, and send
   the finished report to 10-15 of the named consultants from step 1 as a LinkedIn message: *"Ran a
   free technology audit on [specific listed business] — thought this might be useful for a deal
   you're working, or as a sample of what a tech-DD workstream could look like for your practice."*
   This is the free-tool-produces-a-shareable-result pattern, aimed at a named list instead of a mass
   audience.
3. Draft first outreach message (LinkedIn, to a named prospect found via step 1, not DueDilio):

   > Hi [Name] — saw your profile lists technology/IT due diligence as part of your QoE practice. I
   > built a structured audit tool for exactly this gap (DNS/hosting/CMS/SSL fingerprinting, POS and
   > booking-platform contract review, license transferability — the stuff financial QoE explicitly
   > doesn't cover). I ran a free sample report on [specific real listed business] to show the output
   > — [link]. No pitch attached; if it's useful for a live deal, happy to run one on a target you're
   > actually diligencing, also free, to see if it saves you time. Would that be worth 15 minutes?

**Primary channel: direct/LinkedIn outreach to a manually-built list, backed by the free-audit hook.**
Reach: small (40-60 identifiable prospects in the first pass, growing as association directories and
search turn up more) but 100% qualified — every name found this way already advertises the exact
service CloseCheck tools. Cost: $0 cash, 8-12 hours/week (list-building, running free Tier-A audits,
messaging, following up) for the first 6-8 weeks. Time to signal: 2-4 weeks to first reply/meeting,
consistent with LinkedIn-outreach norms for a well-targeted list; this is fast relative to SEO but
slower than the source candidate's dead-end broker-referral motion (6-12+ months) specifically because
this list can be built and contacted without needing to earn trust inside a closed referral network
first — the qualifying fact is public (they already advertise the service), not relational.

**Backup 1 — IBBA Supplier Directory listing ($595-$895/year).** Switch to treating this as primary if
direct outreach reply rates stay under ~5% after the first 40-60 contacts, since the directory is
cheap, durable (ranks and sits there for a year), and reaches business brokers who might refer
CloseCheck to the consultants they already work with — a secondary-buyer path, not the primary one,
but low-cost enough to run in parallel from day one regardless.

**Backup 2 — AM&AA sponsorship/conference presence**, once channel 1 has produced 3-5 paying
customers who can be named as references (a booth or sponsored session pitch is far stronger with
"used by X, Y, Z" than cold). Switch to this once there's a customer story to tell — not before;
cost is unresolved but plausibly $2,000-$10,000+ per conference based on the IBBA sponsorship
benchmarks found, and unjustifiable without proof points yet.

---

## Weekly cost of the primary motion

- **Hours**: 8-12 hours/week for the first 6-8 weeks (list-building 3-4h, running free Tier-A audits
  2-4h depending on how much of the product is built vs. done manually, outreach/follow-up 3-4h).
- **Dollars**: effectively $0 — no paid tools required beyond what CloseCheck already needs to exist
  (the Tier-A audit capability itself). LinkedIn outreach at this volume doesn't require Sales
  Navigator, though a $99/month subscription would speed up list-building and is a reasonable early
  spend.
- **This is a founder-time job, not a hired/outsourced motion**, at least for the first ten — the free
  audits and the specificity of the outreach message are the entire value proposition, and both
  require someone who understands the product well enough to run it manually before it's finished.

---

## Explicitly not doing (yet)

- **DueDilio as a lead-generation source.** Confirmed non-viable — the provider list is anonymized by
  design. Do not budget time trying to scrape, guess, or de-anonymize it.
- **ACG national sponsorship.** Too big, too PE-skewed, opaque five-figure-plus pricing, wrong buyer
  density for a pre-revenue product with zero case studies to justify the spend.
- **Cold email (as opposed to LinkedIn) as the lead motion.** Not ruled out — flagged as the direct
  A/B test worth running in week one — but LinkedIn is the better-reasoned default for this
  population given how associations themselves market to it (professional, identity-forward, not
  inbox-anonymous).
- **SEO as a near-term motion.** Not ruled out as a channel — the DueDilio precedent suggests real
  intent exists — but it is a 6+ month payoff and this session could not even verify basic search
  volume or AIO exposure. Do not commit hours here until the five-minute manual SERP check (flagged
  above) is actually done.
- **A formal DueDilio partnership pitch, this early.** Worth a single cold email to DueDilio once
  CloseCheck has 3-5 paying customers and can show the tool works — not worth chasing now, since
  there's no evidence of appetite and no product proof yet to make the pitch credible.

---

## Verdict

**Viable but slow, and the "small named list" claim in `docs/idea.md` does not survive as written.**
DueDilio does not hand over a contactable list — that specific mechanism is dead. But the underlying
distribution logic survives in a weaker form: the buyer population (consultants who already advertise
technology/IT due diligence as a service) is small and identifiable *some other way* — IBBA's
Supplier Directory, AM&AA's public conference/member presence, and direct search/LinkedIn discovery
of firms already offering this line item. That's a real, if smaller and slower-to-build, list than
the idea doc assumed, reachable through manual list-building plus LinkedIn outreach backed by a free
sample audit, not through DueDilio itself. Time to first 10 paying firms: realistically 2-4 months of
consistent 8-12 hour/week effort, not the 6-12+ month dead end that killed the original service-to-
buyer framing, but also not the "just cold-email 200 named providers" shortcut the reframe implied.
`docs/idea.md` should be corrected: DueDilio is evidence the *category* and *price point* are real,
not a usable go-to-market list.

---

## Sources

- `duedilio.com/our-network/` — retrieved 2026-09-11, direct fetch. Anonymized provider teaser cards;
  confidentiality FAQ quote.
- `duedilio.com` homepage — retrieved 2026-09-11, direct fetch. "Create a free account..." quote,
  nav/footer link structure ("Our Network," "Hire by Specialty," "Join as a Provider," "Partner
  Program").
- `duedilio.com/hire-by-specialty/` — retrieved 2026-09-11, direct fetch. "Technology DD" category,
  no named providers.
- `duedilio.com/partner-program/` — retrieved 2026-09-11, direct fetch. Referral-partner terms, $149
  platform fee, target partner types.
- `duedilio.com/join-network/` — retrieved 2026-09-11, direct fetch. Provider vetting criteria, no
  tooling/software mentioned.
- `ibba.org/resource-center/supplier-directory/` — retrieved 2026-09-11, direct fetch. Technology
  category and subcategories, example listed vendors.
- `ibba.org/wp-content/uploads/2021/03/IBBA-Supplier-Directory-Brochure-and-Form_V4-1.pdf` — fetched
  and read directly 2026-09-11. Basic/Premium listing pricing ($595/$895 per year), category list,
  ibba.org traffic figures (473,937 pageviews, 91,148 new users in period shown).
- `ibba.org/wp-content/uploads/2022/01/ibba-sponsorship-opportunities.pdf` — fetched and read directly
  2026-09-11. Full sponsorship tier pricing (articles, display ads, e-magazine, podcast, bundled
  packages), traffic claim ("30,000 unique pageviews each month"), e-magazine list size ("5,000+"/
  "more than 5,000 individuals").
- `ibba.org/about/` — retrieved 2026-09-11, direct fetch. No public membership count found.
- `amaaonline.com` — retrieved 2026-09-11, direct fetch. "1,100+ professionals," 25 countries, $5M-
  $500M deal range, strategic-partners and advertising pages noted but not priced.
- `acg.org` — retrieved 2026-09-11, direct fetch. "Over 100,000 M&A professionals," 61 local markets.
- `acg.org/sponsorship` — retrieved 2026-09-11, direct fetch. Sponsorship tiers named, no public
  pricing, contact-gated.
- `webdevprofit/research/bizbuysell-main-street-tech-audit/distribution.md` and `market.md` —
  reviewed for context on the prior CAPTCHA-block and the DueDilio "Website Review $500-$5,000" /
  "200+ vetted providers" / "$3B in deal value" figures this research builds on.

## Gaps — not resolved this session

- Live SERP check for "technology due diligence checklist" and "IT audit for business acquisition"
  (search volume, AI Overview presence, top-10 competitors) — blocked by exhausted search-tool budget
  and a Google consent-wall redirect on direct fetch. **Do this manually before any SEO commitment.**
- Current (2026) IBBA sponsorship/directory pricing — the PDF found is 4-5 years old; call
  888-686-4222 or email admin@ibba.org to confirm current rates before budgeting.
- ACG and AM&AA chapter-level (as opposed to national) sponsorship pricing — not checked; plausibly
  the more affordable, faster entry point than national-level programs at either association.
- AM&AA's member directory (`amaa.wildapricot.org/directory`) — not checked whether it exposes real
  names/firms to logged-in members (this would be a genuinely contactable list, unlike DueDilio's, if
  membership or a lower-tier access level grants it).
- A verified third-party case study of a comparable narrow-professional-population B2B SaaS's channel
  mix and CAC — none found and cited this session; the LinkedIn-over-cold-email conclusion in section
  2 is reasoned, not evidenced, and should be tested directly rather than trusted.
