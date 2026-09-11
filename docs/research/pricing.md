# Pricing and monetization model — CloseCheck

Researched 2026-09-11. Scope: a B2B SaaS selling structured technology due-diligence audit
workflows to independent M&A/QoE/IT-diligence consultants and small advisory firms assessing
small-business acquisitions ($200k–2M deals). Buyer runs roughly 2–50 acquisition-related audits
per **year**, not per month. Builds on `docs/idea.md` and the source evidence in
`~/dev/webdevprofit/research/bizbuysell-main-street-tech-audit/`. `spec.md` §9 already makes a
placeholder pricing decision (per-seat monthly, explicitly "not per-audit usage," numbers marked
as placeholders); this document stress-tests that decision against comparables and arithmetic
rather than assuming it's settled.

`WebSearch` was exhausted session-wide before this task started (0 of 200 remaining budget) —
confirmed on the first five parallel calls. All pricing evidence below was retrieved via direct
`WebFetch` against vendor pricing pages; Clio's pricing page and G2's Clio pricing page both
returned HTTP 403 to every attempt and are marked `BLOCKED`.

---

## Verdict

**Workable, but the spec's current "per-seat, not per-audit" decision is the wrong default given
how infrequently this buyer works — a hybrid (low base subscription + per-audit overage, or an
annual plan with bundled audit credits) fits the usage pattern better and produces materially
better unit economics than a flat monthly seat fee.** $3,000/mo is a plausible early milestone in
customer-count terms (16–62 customers depending on model and price point), but the 200+ DueDilio
figure overstates the immediately reachable population for *this specific* category — DueDilio's
own pricing page shows "Website Due Diligence" is one line item among six diligence disciplines
(QoE, financial, legal, commercial, operational, HR/insurance), so the technology-specialist
subset of that 200+ is almost certainly well under 100, and likely under 50. Hitting $3k/mo
requires reaching beyond DueDilio into QoE generalists and independent IT consultants who don't
currently offer this as a line item at all — a harder, consultative sale, not a tool-swap sale.

---

## 1. Pricing model: per-seat, per-audit, or hybrid

### The comparable set (all `EVIDENCE`, retrieved 2026-09-11 via direct `WebFetch`)

| Tool | Vertical | Entry tier | Mid tier | Top tier | Billing unit |
|---|---|---|---|---|---|
| [Financial Cents](https://financial-cents.com/pricing/) | Accounting practice mgmt | $19/mo (Solo, 1 user) | $49/user/mo (Team, annual) | $69/user/mo (Scale, annual) | Per user/month, monthly add-ons (Month-End Close: $5/client/mo) |
| [Karbon](https://karbonhq.com/pricing/) | Accounting practice mgmt | $59/user/mo (Team, annual) | $89/user/mo (Business, annual) | Custom (Enterprise) | Per user/month |
| [Canopy](https://www.getcanopy.com/pricing) | Accounting practice mgmt | $74/user/mo (Standard, annual) | $109/user/mo (Plus) | $149/user/mo (Premium) | Per user/month, usage add-ons (Close Automation $10/connected client/mo, Tax Workflow $34/client/yr) |
| [MyCase](https://www.mycase.com/pricing/) | Legal practice mgmt | $50/user/mo (Basic, annual) | $100/user/mo (Pro, annual) | $130/user/mo (Advanced, annual) | Per user/month |
| Clio | Legal practice mgmt | — | — | — | `BLOCKED` — pricing page and G2's pricing page both returned HTTP 403 on every fetch attempt this session. Not independently verified; general pre-training knowledge puts Clio in the same $39–130/user/month band as the others, but flag as `ASSUMPTION`, unverified this session. |

**Pattern, `INFERENCE`:** every one of these tools is sold per-seat, flat, no usage component (aside
from small per-client automation add-ons), clustering **$19–150 per user/month**, entry tiers
around $19–74/mo and premium/automation tiers around $89–150/mo. This is a real, load-bearing
anchor for what small professional-services practices already pay for vertical SaaS.

**But the reason it works for these five tools doesn't transfer cleanly to CloseCheck, `INFERENCE`:**
Karbon, Financial Cents, Canopy, MyCase (and presumably Clio) are all **daily-workflow hubs** — email
triage, task management, time tracking, billing, client CRM — for a practice that has ongoing active
clients essentially every week of the year. The subscription is justified by continuous use, not
by any single engagement. CloseCheck's use pattern is structurally different: a consultant opens it
only when an acquisition audit is actually in flight, and per the idea brief that's **2–50 times a
year**, not daily. A flat per-seat fee priced like a daily-use practice-management hub risks the
buyer feeling they're "paying for dead months" — the exact "will this pay for itself" hesitation
`spec.md` §9 cites as the reason to avoid per-audit pricing, just inverted onto the subscription
itself.

### DueDilio's own monetization is a relevant data point, `EVIDENCE`

[DueDilio's own site](https://duedilio.com/) monetizes its marketplace not with a subscription but
with **a one-time $149 lifetime-access fee** ("No subscription... no per-project charges" per its
own FAQ) for buyers posting diligence projects. That's the opposite end of the same ecosystem
(deal-side buyers posting a project, not providers running audits) but it's a directly relevant
signal: the platform closest to this exact buyer population chose a one-time/flat-access model over
recurring billing, `INFERENCE` because its own users transact infrequently too. Not proof CloseCheck
should be one-time, but a second independent signal (alongside the usage-frequency argument above)
that recurring-forever billing is not the obvious default in this ecosystem the way it is in daily-use
accounting/legal practice tools.

### Recommendation: hybrid — low base subscription + per-audit overage (or bundled audit credits)

- **Base subscription, $29–39/mo (Solo, 1 seat).** Keeps the account "always on" for the parts that
  have value between engagements regardless of audit volume: template library, whitelabel/brand-kit
  setup, and — per `spec.md` §9's own good idea — **unlimited Tier A (external, no-seller-cooperation)
  runs**, which a consultant can plausibly use pre-LOI on deals that never convert to a full audit, as
  a top-of-funnel/credibility tool. This gives the subscription continuous light-touch value even in
  months with no full audit, partially answering the "dead months" objection.
- **Per-audit fee for full Tier B/C audits, $49–79/audit**, with 2–3 included per year in the base
  plan to reduce the "will this pay for itself on audit one" hesitation for a brand-new low-volume
  user, then metered beyond that.
- **Team tier**: additional seats at $20–30/seat/mo on top of the base, following the comparable
  set's per-seat-for-multi-person-firms pattern (see §4).

This is not a rejection of `spec.md`'s subscription instinct — a pure per-audit model has its own
problem (no predictable revenue, and re-creates exactly the line-item hesitation spec.md correctly
flags). It's a correction to "per-seat flat, no usage component," which ignores that this buyer's
usage frequency is the one variable most different from every comparable found.

**Alternative if usage-based billing is judged too complex for v1:** an **annual-only plan with
bundled audit credits** (e.g., $588/year = $49/mo equivalent, includes 6 audits, additional at $69
each) gets most of the same benefit — it removes the monthly cancel-between-deals risk (see §5) by
committing the buyer for a year, while still linking price to usage via the credit-overage
mechanism. This is closer to `spec.md`'s "predictable cost" rationale while still addressing the
frequency mismatch.

---

## 2. Volume needed: customers/audits required for $3k, $10k, $30k per month

### Per-seat, flat monthly (spec.md's current default)

| Price | $3,000/mo | $10,000/mo | $30,000/mo |
|---|---|---|---|
| $49/mo | 62 customers | 205 customers | 613 customers |
| $99/mo | 31 customers | 101 customers | 303 customers |
| $199/mo | 16 customers | 51 customers | 151 customers |

Arithmetic: customers = target ÷ price. Shown for one seat per customer (solo-consultant-dominant
mix); a Team-tier mix would reduce customer count somewhat and is addressed in §4.

### Pure per-audit fee

| Price | $3,000/mo | $10,000/mo | $30,000/mo |
|---|---|---|---|
| $50/audit | 60 audits/mo | 200 audits/mo | 600 audits/mo |
| $99/audit | 31 audits/mo | 101 audits/mo | 303 audits/mo |
| $150/audit | 20 audits/mo | 67 audits/mo | 200 audits/mo |

Converting audits/month to *customers*, using the stated 2–50 audits/year range: at a plausible
blended average of **0.5–1.5 audits/customer/month** (`ASSUMPTION`, midpoint of the stated annual
range, skewed toward the lower end because a true occasional user, 2–5/year, is the least likely
segment to sustain any recurring vendor relationship — self-selection toward more active users
among paying customers), customer counts for $3,000/mo at $99/audit range from **21 to 62
customers**, materially wider and generally *more* customers required than the flat-seat model at
an equivalent price point, because usage-based revenue on a low-frequency buyer is inherently thin
per customer.

### Hybrid (recommended): $39/mo base + $59/audit beyond 2 included/year

Blended ARPU depends on the individual customer's annual audit volume:

- Light user, 4 audits/year: $39×12 + 2×$59 = $468 + $118 = $586/yr → **$48.83/mo**
- Mid user, 10 audits/year: $468 + 8×$59 = $468 + $472 = $940/yr → **$78.33/mo**
- Heavy user, 25 audits/year: $468 + 23×$59 = $468 + $1,357 = $1,825/yr → **$152.08/mo**

Using **$65/mo blended ARPU** as a base case (`ASSUMPTION`, weighted toward the lower-volume solo
consultants who make up the majority of the DueDilio-type population per §4):

| Target | Customers needed at $65/mo blended ARPU |
|---|---|
| $3,000/mo | 47 |
| $10,000/mo | 154 |
| $30,000/mo | 462 |

### Is $3,000/mo plausible against the known buyer population?

**In customer-count terms, yes — 16 to 62 customers is a small number in isolation.** Against the
200+ DueDilio anchor alone, that's an 8–31% conversion of that one list, which sounds aggressive
for cold B2B SaaS in year one (typical outbound-led SMB conversion benchmarks run 1–5% of a cold
list over 12 months, `ASSUMPTION`, general benchmark not sourced this session) — **but the 200+
figure is the wrong denominator.**

**Correction, `INFERENCE` from `EVIDENCE`:** DueDilio's own site lists six diligence disciplines
(QoE, financial, legal, commercial, operational, HR/insurance) plus "Website Due Diligence"
($500–5,000), "Software Code Review" ($4,000–10,000), "Cybersecurity Assessment" ($6,000–20,000),
and "IT Strategy & Roadmap" ($2,000–10,000) as *categories within* that provider network — meaning
the 200+ is the total across every diligence discipline, not 200+ technology specialists.
`ASSUMPTION`: if technology-focused providers are 10–25% of the 200+ (no breakdown was published or
found), the immediately-relevant in-category slice of DueDilio alone is **20–50 providers** — a
population from which 16–62 paying customers is not reachable without also converting
non-technology-specialist providers.

**The real path to $3,000/mo is therefore not "convert DueDilio's tech-DD listings" but "convert
QoE generalists and independent IT consultants who don't currently offer technology diligence as a
line item at all into offering it, using this tool."** That's a harder sale — it requires the
prospect to adopt a new service line, not just switch tooling for a service they already sell — and
the total addressable population for that broader pitch is larger and less enumerable than 200.
`ASSUMPTION`, reasoned: US-based boutique M&A/QoE advisory firms, fractional CTOs, and IT
consultants who could plausibly add this as a service number in the **1,000–3,000** range (DueDilio
is one of several diligence marketplaces — Axial and similar exist — and most independent
consultants in this space aren't marketplace-listed at all). Against that broader denominator, 16–62
customers is 0.5–6% — plausible for a year of focused outbound plus content, but this reframes the
sale from "sell software to people already doing this work" to "convince people to start offering a
service, using your software" — a longer, more consultative motion than the comparable-tool CAC
logic in §5 assumes at face value.

---

## 3. Willingness-to-pay risk: infrequent use vs. recurring subscription

This is the central risk `spec.md` §9 doesn't fully address. Stated plainly: **a solo consultant
running 5 audits a year is being asked to pay a subscription for 12 months to use a tool
meaningfully in perhaps 3–5 of them.** Two failure modes, both real:

1. **Sticker shock at signup** — "why would I pay monthly for something I use occasionally" is the
   first objection a self-serve pricing page will get from this buyer, and it's a harder objection
   to pre-empt on a pricing page than the per-audit line-item hesitation `spec.md` cites, because it's
   visible before the buyer has done a single audit.
2. **Cancel-between-deals churn** — even a buyer who signs up will have an obvious, low-friction
   moment to cancel: the first month after closing a deal, before their next one is in the pipeline.
   This is structurally different from Karbon/Canopy/MyCase's buyer, who never has a "no active
   clients" month. `INFERENCE`: this is likely to show up as **elevated monthly churn concentrated
   right after individual engagements close**, not steady-state SaaS churn — a pattern the comparable
   set's pricing model was never designed to survive.

**Which model reduces this hesitation most:**

- **Per-audit, pay-as-you-go** removes objection #1 entirely (no idle-month cost) but reintroduces
  the "will this specific $79 pay for itself on this specific deal" friction `spec.md` was trying to
  avoid, and produces zero predictable revenue for CloseCheck between engagements.
- **Flat per-seat, monthly** (spec.md's current default) removes objection #2's ambiguity (revenue
  is contractually there regardless of usage) but maximizes objection #1 and the cancel-between-deals
  risk described above.
- **Annual billing with bundled audit credits** is the best fit for *this specific* mismatch: it
  removes the monthly cancel-decision entirely (no monthly renewal point to defect at), ties price to
  a chunk of expected usage (reducing "I might not use this" anxiety at signup because the credits
  are pre-allocated, not a recurring toll), and still gives CloseCheck predictable, front-loaded
  revenue. `INFERENCE`, no direct evidence this specific audience prefers annual billing — this is
  reasoned from the usage-frequency mismatch, not tested.

---

## 4. Expansion / land-and-expand: does firm size support tiering

**No direct census of DD-consultant firm sizes was found this session** — this is the weakest-evidenced
section. What exists:

- `spec.md` §1 already assumes "typically solo or 2–10 person firms," citing DueDilio's 200+ listed
  providers and Rapid Diligence-style QoE shops as examples — `ASSUMPTION`, carried from prior
  research, not independently re-verified this session.
- Rapid Diligence (from the source research, `~/dev/webdevprofit/research/.../competitors.md`)
  markets multiple named engagement types (QoE, QoE Lite, Preliminary Vetting) and "reviewed 250+
  deals over five years" — a volume that plausibly implies more than one person, but firm headcount
  was not found. `EVIDENCE`, carried, headcount inference is `ASSUMPTION`.
- The named QoE providers in the same source (Regalis Capital, AcquisitionAce, SecureDataRooms) are
  firm names, not solo-practitioner names, consistent with — but not proof of — a multi-person
  structure.
- **The strongest indirect evidence is the comparable set itself**: every one of Karbon, Financial
  Cents, Canopy, and MyCase prices per-seat specifically *because* their markets (accounting and
  legal practice) span solo practitioners through 50+ person firms, and per-seat pricing is the
  mechanism all four independently converged on to monetize that spread. `INFERENCE`: professional
  DD/M&A advisory firms almost certainly have comparable size variance (boutique advisory shops
  commonly run 2–15 staff), so the *mechanism* — per-seat tiering — is well-precedented in adjacent
  professional-services SaaS even though this session found no direct count of how many CloseCheck-
  relevant firms fall into which size bucket.

**Recommended upgrade trigger, two dimensions, not one:** seats (for multi-person firms, following
every comparable) *and* audit volume (specific to CloseCheck's usage-episodic nature, not present
in the daily-use comparables). A solo consultant running 25 audits/year should pay more than one
running 4/year even on a single seat — the hybrid model in §1 captures this naturally via the
per-audit overage, which none of the five comparables need because their usage is volume-invariant
(a $500k-revenue accounting practice and a $2M one both use Karbon "continuously," but a DD
consultant's revenue is close to linear in audit count).

---

## 5. Unit economics: CAC, is it lower than the original candidate faced

### Why the buyer-list shape genuinely changes CAC, `INFERENCE`

The original `bizbuysell-main-street-tech-audit` candidate's distribution research (see
`~/dev/webdevprofit/research/bizbuysell-main-street-tech-audit/distribution.md`) found the
acquisition-buyer population **structurally unreachable cold**: anonymous until they enter a deal,
discoverable only inside a 3-week DD window per transaction, and routed through broker/attorney/CPA
referral networks that explicitly exclude unproven one-way vendors (5–8 core relationships,
"one-way referral pipeline" named as the exact failure mode brokers filter for — `EVIDENCE`,
carried). CloseCheck's buyer is the opposite shape on every one of those dimensions: **stable (the
same consultant is a prospect every month, not just during one deal), named and publicly listed**
(DueDilio profiles, firm websites, LinkedIn), and **not gated by a referral network** — a consultant
doesn't need anyone's permission to buy software for their own practice. This is a genuinely easier
cold-outreach target, `INFERENCE`, not just a smaller one.

### CAC estimate

`ASSUMPTION`, no comparable found this session for DD-consultant-specific CAC: **$300–1,000 per
customer** for founder-led cold outreach (email/LinkedIn to named DueDilio profiles) plus
content/SEO targeting "technology due diligence" and adjacent QoE search terms. Reasoning:

- Lower bound of the range reflects the small-enumerable-list advantage (near-zero wasted spend
  reaching non-buyers, personalized outreach at low per-contact cost) — closer to typical
  self-serve PLG SMB SaaS CAC benchmarks (~$200–500, general benchmark, not sourced this session).
- Upper bound reflects the §2 correction: a meaningful share of the addressable population (QoE
  generalists, IT consultants) needs to be sold on adopting a *new service line*, not just switching
  tools for a service they already sell — a longer, more consultative sales cycle that raises
  effective CAC above a pure tool-swap benchmark.

### Cost to serve and margin

- **Variable cost per audit** (Tier A automated checks — WHOIS/DNS/SSL/GBP lookups — plus any
  LLM-assisted report drafting): **$1–5/audit**, `ASSUMPTION`, no architecture spec exists yet to
  price exact API calls against.
- **Fixed infra** (hosting, document/screenshot storage, client-portal hosting) at dozens-to-low-
  hundreds of customers: **$100–400/mo**, `ASSUMPTION`.
- **Gross margin**, at $49/mo per-seat with ~1 audit/customer/month: (49 − 1 to 5) / 49 = **90–98%**.
  At half price ($24.50/mo): (24.50 − 1 to 5) / 24.50 = **80–96%**. Margin is not the constraint in
  this model — cost to serve is genuinely near-zero at this scale; the constraint is volume and
  churn, not unit cost.

### Churn, LTV:CAC, payback

`ASSUMPTION` throughout — no churn data exists for this exact buyer/product combination.

- **Flat per-seat monthly, base case**: 4–8%/month churn (elevated relative to typical vertical SaaS
  4–6%/month baseline, because of the cancel-between-deals risk in §3). At 6%/month (~16.7-month
  average lifetime), 90% margin, $49/mo: **LTV ≈ $736**. Against CAC $300–1,000: **LTV:CAC ≈
  0.7:1–2.5:1** — below the 3:1 bar in most of this range, a real risk.
- **Hybrid/annual-leaning, base case**: annual billing structurally removes the monthly cancel point,
  plausibly pushing effective churn lower, 3%/month equivalent (~33-month average lifetime). At $65/mo
  blended ARPU, 90% margin: **LTV ≈ $1,931**. Against CAC $300–1,000: **LTV:CAC ≈ 1.9:1–6.4:1** —
  meaningfully better, and the strongest quantitative argument in this document for the hybrid model
  over spec.md's current flat-monthly default.
- **Payback period**: CAC ÷ (ARPU × margin). Flat $49/mo: $300–1,000 ÷ $44.10 = **6.8–22.7 months**.
  Hybrid $65/mo: $300–1,000 ÷ $58.50 = **5.1–17.1 months**. Both are long for a bootstrapped
  operation but not unusual for high-margin vertical SaaS, provided churn stays near the base case.

---

## 6. Pessimistic case

Half price, double churn, triple CAC, applied to the flat per-seat base case ($49/mo, 6%/month
churn, $650 CAC):

- Price → $24.50/mo. Churn → 12%/month (~8.3-month average lifetime). CAC → $1,950.
- LTV = $24.50 × 0.9 × 8.3 ≈ **$183**.
- LTV:CAC = 183 ÷ 1,950 ≈ **0.09:1** — the model is deeply underwater.
- Payback = 1,950 ÷ ($24.50 × 0.9 = $22.05) ≈ **88 months** — never realistically recovered before
  churn takes the customer.

Applied to the hybrid base case ($65/mo blended, 3%/month churn, $650 CAC):

- Price → $32.50/mo. Churn → 6%/month (~16.7-month average lifetime). CAC → $1,950.
- LTV = $32.50 × 0.9 × 16.7 ≈ **$489**.
- LTV:CAC = 489 ÷ 1,950 ≈ **0.25:1** — also underwater, though the hybrid model degrades less
  severely because its churn-reduction mechanism (annual commitment) is structural, not just a
  price assumption, and survives the "double churn" stress somewhat better in relative terms.

**Both models fail the pessimistic case.** This is expected at this stage — the pessimistic case
exists to show fragility, not to be survived — but it underscores that this business has very
little room for error on churn specifically, more than on price or CAC individually.

---

## 7. The one number to validate first

**Will this buyer pay any recurring fee at all for a tool they'll use a handful of times a year, and
at what price — tested head-to-head against a pure per-audit alternative, before committing to
either billing architecture.** Every other number in this model (price point, customer count needed,
churn assumption, LTV:CAC) is downstream of this one. The entire case for the hybrid recommendation
over `spec.md`'s flat-per-seat default rests on an `INFERENCE` about usage-frequency mismatch that
has not been tested against an actual prospect. The cheapest test: pitch 10–15 named DueDilio-listed
technology-DD providers directly, offering both a subscription and a per-audit option side by side,
and record which one they choose and what price triggers hesitation — before building billing
infrastructure around either model. This also resolves §2's harder open question for free: whether
the pitch needs to be "switch your tooling" (existing tech-DD providers) or "add a service line"
(QoE generalists/IT consultants), since the two populations will react differently to the same
pricing conversation.

---

## Saved to

`docs/research/pricing.md`
