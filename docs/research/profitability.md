# Profitability and unit economics — CloseCheck

Researched 2026-09-21. Scope: profitability of CloseCheck as built (Phases 1–3 complete: three-tier
audit engine, whitelabeled PDF reports, client portal, team plans, self-serve signup) against
current 2025–2026 market pricing of comparable tools, vertical-SaaS benchmark data, and CloseCheck's
actual cost structure (Render hosting, Tier A API lookups, PDF generation, Stripe).

Builds on `docs/research/pricing.md` (2026-09-11) and `docs/research/market.md` (2026-09-11). Unlike
those sessions, `WebSearch` was fully available this session; findings below are search-derived with
URLs cited inline. Confidence levels per claim: `EVIDENCE` (directly sourced this session),
`INFERENCE` (reasoned from evidence), `ASSUMPTION` (unverified, flagged).

This file does **not** edit `pricing.md` or `spec.md`. Contradictions with the existing baseline are
flagged in §5 for a follow-up `spec-writing` pass, per the project convention (update the spec, keep
superseded reasoning visible).

---

## Verdict

**CloseCheck's cost structure is a non-issue — gross margin at any plausible price is 95%+, and
fixed infra at early scale is ~$15–60/mo on Render. Profitability is decided almost entirely by
three revenue-side variables: churn (the fragile one), price per audit (currently set too low
against 2025–26 comparables), and CAC (pricing.md's lower bound now looks optimistic against fresh
benchmarks).** The most consequential new finding: the comparable set has shifted since the
2026-09-11 research. Deliverable-generating tools sold to solo professionals — the closest structural
analogs to CloseCheck, not the practice-management hubs pricing.md anchored on — price materially
higher: Spectora at $109/mo, BizEquity at ~$240 for a solo advisor, Fathom at $44–399/mo, and
Finsider.ai at **$1,500–4,000 per engagement** for AI-assisted QoE reports sold to solo searchers.
The $49–79/audit overage band in `spec.md` §9 captures roughly 1.5–10% of the consultant's own
$500–5,000 engagement fee for the same deliverable — comparables suggest 10–30% capture is payable.
Flagged as a contradiction in §5.

---

## 1. Comparable tool pricing, 2025–2026

### 1a. M&A deal-management and VDR products — confirms whitespace below $100/mo

| Tool | Price (2026) | Segment | Source |
|---|---|---|---|
| DealRoom | $1,250/mo Single ($1,000/mo annual), $3,000/mo Professional, flat with unlimited users | Mid-market M&A/PE | [datarooms.co](https://www.datarooms.co/pricing/dealroom), [tryplox.com](https://www.tryplox.com/blog/dealroom-pricing) |
| Midaxo | ~$10,000/yr list floor; Vendr buyer-reported median ~$51,875/yr; $20–50k+ implementation | Corp dev / enterprise | [softwareadvice.com](https://www.softwareadvice.com/collaboration/midaxo-profile/), [vendr.com](https://www.vendr.com/marketplace/midaxo) |
| Datasite Acquire | $25K–$90K per deal | Large-cap PE, i-banks | [ctacquisitions.com](https://ctacquisitions.com/best-quality-of-earnings-software-2026/) |
| Intralinks DealVision | $30K–$120K per deal | Large-cap, multi-jurisdiction | same |
| iDeals (VDR) | ~$3–15K/yr | SMB–mid-market deals | [papermark.com](https://www.papermark.com/blog/virtual-data-room-cost) |
| CapLinked (VDR) | ~$2–15K/yr; mid-market flat-rate VDRs cluster $399–995/mo | Mid-market | same, [peony.ink](https://www.peony.ink/blog/virtual-data-room-cost-guide) |
| Firmex (VDR) | ~$5–30K/yr, quote-based | Lower-middle-market ($5–50M deals) | same |
| Digify Pro | ~$140/mo — cheapest real VDR found | Smallest deals | [papermark.com](https://www.papermark.com/blog/virtual-data-room-cost) |

All `EVIDENCE` (aggregator-reported; roughly half the VDR market publishes no pricing, so these are
buyer-reported/aggregated figures — treat exact numbers as ±20%).

**`INFERENCE`:** none of these serve CloseCheck's buyer. The cheapest credible deal-infrastructure
product is ~$140/mo and the M&A-branded ones start at $1,000+/mo. For a consultant on a $200k–2M
Main Street deal, this entire category is priced out — which is both the whitespace CloseCheck
occupies and a ceiling reference: CloseCheck's full stack (audit engine + portal + reports) at
$29–79/mo sits far below the cheapest adjacent alternative. There is no competitive pressure forcing
CloseCheck's price down; the binding constraint is only the buyer's own willingness to pay.

### 1b. QoE software — the category grew a low end since the 2026-09-11 research

From a 10-vendor 2026 QoE-software comparison
([ctacquisitions.com](https://ctacquisitions.com/best-quality-of-earnings-software-2026/), `EVIDENCE`,
single-source aggregator — corroborate the two load-bearing rows before relying on exact numbers):

| Vendor | Pricing | Target |
|---|---|---|
| **Finsider.ai** | **$1,500–$4,000 per engagement** | **Solo searchers, independent sponsors** |
| **Fathom** | **$44–$399/mo per company** | **Sub-$5M-EBITDA SMB diligence** |
| DealRoom (QoE module) | $2,000–4,000/user/mo | Mid-market PE |
| Trullion | $1,500–3,500/mo per workspace | Regulated/lease-heavy deals |
| Mosaic, Cube | $1,500–3,000/mo | FP&A / portfolio companies |
| Begin, Aprio | $25K–150K per engagement | Advisory services, not software |

Context: a human QoE report for a sub-$10M-revenue business runs **$25,000–35,000**
([bdemerson.com](https://www.bdemerson.com/article/quality-of-earnings-report-cost),
[bedrockqoe.com](https://www.bedrockqoe.com/insights/quality-of-earnings-report-cost), `EVIDENCE`).
Finsider.ai launched September 2025 explicitly to automate that at $1,500–4,000/engagement
([finance.yahoo.com](https://finance.yahoo.com/news/quality-earnings-software-launched-finsider-162500493.html)).

**`INFERENCE`, load-bearing:** the QoE-software market now prices *per engagement/deal* at the low
end, not per seat — and solo practitioners demonstrably pay four figures per engagement when the tool
produces the client deliverable. CloseCheck's tech-DD deliverable is smaller in scope than a QoE
report (the consultant's own fee is $500–5,000, not $25–35K, per DueDilio's published bands carried
from `pricing.md`), so CloseCheck cannot charge Finsider prices — but the *ratio* transfers:
Finsider captures ~6–16% of the value of the human deliverable it replaces. Applied to a $500–5,000
tech-DD engagement, 6–16% is **$30–800 per audit** — the current $49–79 band sits at the very bottom
of that range for mid-band engagements.

### 1c. Deliverable-generating tools for solo professionals — the best structural analogs

| Tool | Price (2026) | Analog quality | Source |
|---|---|---|---|
| **Spectora** (home inspection reports) | **$109/mo** software-only, unlimited inspections; +$89/mo per added inspector; $999/yr annual; Advanced add-on $3–4 per published inspection | Best analog: solo professional, whitelabeled client-facing PDF report is the product of the engagement | [poolverify.io](https://poolverify.io/resources/spectora-pricing-breakdown-comparison), [capterra.com](https://www.capterra.com/p/157144/Spectora/) |
| HomeGauge (same category) | ~$99/mo + add-ons; now owned by Spectora | same | [inspectordata.com](https://inspectordata.com/blog/homegauge-vs-spectora-comparison.html) |
| **BizEquity** (valuation reports for advisors) | starts at **$240 for a single advisor** (Advisor Solo); sales-assisted, no self-serve | Advisor produces a client-facing valuation report; replaces an $8,000 manual valuation | [unbroker.com](https://unbroker.com/best-business-valuation-software-for-non-financial-experts-2025/), [investimon.com](https://investimon.com/top-10-best-business-valuation-software-tools-for-2025-ranked-reviewed/) |
| Fathom (financial analysis/reporting) | $44/mo Lite → $399/mo unlimited companies | Per-company tiering = usage-linked pricing in an adjacent report tool | [ctacquisitions.com](https://ctacquisitions.com/best-quality-of-earnings-software-2026/) |

All `EVIDENCE`. Caveat on Spectora, `INFERENCE`: a home inspector runs 10–40 inspections/**month**,
vs. a DD consultant's 2–50 audits/**year** — so Spectora can charge $109/mo flat-unlimited because
per-use value is amortized across high volume. The lesson for CloseCheck is *not* "charge $109/mo
flat" but "the whitelabeled-report-generator category supports ~$100+/mo from solo professionals
when usage justifies it" — which for CloseCheck's low-frequency buyer argues for capturing that same
revenue through the per-audit component instead of the base fee. This *supports* pricing.md's hybrid
architecture while arguing its per-audit number is set too low (§5).

### 1d. Important non-finding

No direct competitor — structured tech-DD audit software for Main-Street deals with self-serve
pricing — surfaced in any of this session's searches (QoE comparison lists, VDR comparisons,
inspection-software comparisons). Consistent with `market.md` §2's "not found" (which had G2/Capterra
blocked). `EVIDENCE` of continued absence, moderate confidence — category pages were still not
individually swept this session.

---

## 2. Vertical-SaaS profitability benchmarks (2025–2026)

- **Churn (SMB segment):** monthly churn for SMB-sold SaaS benchmarks at **3–5%/month**; SMB churn
  runs ~8x enterprise; **43% of all SMB customer losses occur in the first quarter post-purchase**
  (onboarding/time-to-value is the highest-leverage retention investment).
  ([optif.ai](https://optif.ai/learn/questions/b2b-saas-churn-rate-benchmark/),
  [venasolutions.com](https://www.venasolutions.com/blog/saas-churn-rate),
  [wearefounders.uk](https://www.wearefounders.uk/saas-churn-rates-and-customer-acquisition-costs-by-industry-2025-data/)) `EVIDENCE`.
- **Monthly vs annual billing:** annual plans retain ~92% of customers vs ~68% for monthly in one
  dataset; defaulting to annual billing with a 15–20% discount cuts churn **40–60%**; the most
  common annual discount is **17% ("2 months free")**, range 10–25%.
  ([baremetrics.com](https://baremetrics.com/blog/annual-vs-monthly-pricing-better-retention),
  [growthspreeofficial.com](https://www.growthspreeofficial.com/blogs/b2b-saas-annual-contract-length-multi-year-discount-benchmarks-2026-impact-on-retention-payback),
  [dodopayments.com](https://dodopayments.com/blogs/annual-vs-monthly-billing-saas)) `EVIDENCE`
  (aggregated vendor-blog benchmarks, directionally consistent across four independent sources; exact
  percentages vary by dataset).
- **CAC:** average B2B SaaS blended CAC ≈ **$1,200**, up ~14% through 2025; SMB CAC payback should
  be under 12 months.
  ([wearefounders.uk](https://www.wearefounders.uk/saas-churn-rates-and-customer-acquisition-costs-by-industry-2025-data/),
  [thesaaslibrary.com](https://thesaaslibrary.com/saas-metrics-explained/)) `EVIDENCE`, blended
  average across segments — founder-led niche outbound can undercut it, but it moves the plausible
  midpoint up from pricing.md's range (§5).
- **Solo-founder revenue reality:** 2025 micro-SaaS distribution — ~30% never reach $1K MRR, ~50%
  plateau at $1–10K MRR, ~15% reach $10–100K, ~5% exceed $100K. Median time to $10K MRR:
  **12–18 months from first paying customer**. Bootstrapped micro-SaaS typically runs 70%+ profit
  margin. ([flowjam.com](https://www.flowjam.com/blog/27-micro-saas-examples-that-actually-print-money-in-2025),
  [softwareseni.com](https://www.softwareseni.com/solo-founder-saas-metrics-from-0-to-10k-mrr-in-6-months-with-realistic-timelines/))
  `EVIDENCE`, low-moderate confidence — indie-hacker-sphere aggregations, survivorship-prone, but
  directionally the right calibration: **CloseCheck's realistic base case is the $3–10K MRR
  plateau band, and `spec.md` §11's targets should be read against a 12–18-month clock, not a
  6-month one.**

---

## 3. CloseCheck's actual cost structure (as built)

### Fixed infrastructure — Render

Render 2026 pricing (`EVIDENCE`,
[render.com](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses),
[kuberns.com](https://kuberns.com/blogs/render-pricing/),
[livemy.app](https://livemy.app/blog/render-pricing)):

- Web service: Starter $7/mo (512MB) → Standard $25/mo (2GB/1CPU) → Pro $85/mo (4GB/2CPU).
- Postgres: Basic-256mb $6/mo upward; storage $0.30/GB/mo.
- Workspace: Hobby $0 (1 seat, 5GB bandwidth) → Pro $25/mo (25GB bandwidth).

**`INFERENCE`, sized to CloseCheck's stack (Next.js + Postgres + document storage):** ~$13–40/mo at
launch scale (Starter/Standard web + small Postgres + Hobby workspace), ~$60–150/mo at 100–200
customers (Standard/Pro web + larger Postgres + Pro workspace + document-storage growth). Document
uploads (Tier B) are the only line that scales with usage, at $0.30/GB/mo — hundreds of audits with
say 50–200MB of documents each is still tens of GB, i.e., tens of dollars. **Even at 200 customers,
fixed infra is under 2% of revenue at a $65 ARPU.**

### Variable cost per audit

- **Tier A lookups (WHOIS/DNS/SSL):** commodity-priced. Whoxy: $2 per 1,000 WHOIS queries
  ([whoxy.com](https://www.whoxy.com/pricing.php)); WhoisJSON: free tier 1,000/mo, $10/mo for
  30,000 — and its plans bundle WHOIS + DNS records + SSL validation + domain availability in one
  API ([whoisjson.com](https://whoisjson.com/pricing)). `EVIDENCE`. Per Tier A run (a dozen-odd
  lookups): **under $0.05**. Note, `EVIDENCE`: ICANN sunset legacy WHOIS in January 2025 and 374
  gTLDs have shut off port 43 ([rdapapi.io](https://rdapapi.io/blog/whois-api-alternatives)) — Tier A
  should be built/kept on RDAP or an API vendor that has migrated, not raw port-43 WHOIS; this is a
  reliability note, not a cost one.
- **PDF generation:** runs on CloseCheck's own compute (headless-Chromium-class rendering in the
  existing Render service) — no per-unit vendor cost, only marginal CPU. Effectively $0. `INFERENCE`
  from the stack; no third-party PDF API is in evidence in the architecture.
- **LLM-assisted drafting, if/when added:** the only variable cost that could become material;
  order of $0.05–0.50/report at current model prices for a report-length generation. `ASSUMPTION` —
  not currently in the audit pipeline; re-cost against the actual model and token budget if added.
- **Total variable cost per full audit: well under $1** — below even pricing.md's $1–5 assumption.
  `INFERENCE`, high confidence.

### Payment processing

Stripe standard: 2.9% + $0.30 per card transaction (`ASSUMPTION` at the exact-number level —
industry-standard published rate, not re-fetched this session). **`INFERENCE`, real but minor
design input:** on a $39 monthly charge, Stripe takes ~3.7%; on a $468 annual charge, ~3.0%; on
many small $59 per-audit charges, ~3.4% each. Annual billing is also the cheapest to process — a
small additional point for annual-default, and a reason to batch overage billing (monthly rollup
invoice) rather than charging per audit event.

### Support load

`ASSUMPTION`, reasoned: the product's audit-episodic usage concentrates support demand into each
customer's active-audit windows, and the 43%-of-churn-in-first-quarter benchmark (§2) says
onboarding is where support effort pays. At <100 customers averaging ~1 audit/month each, this is
single-founder-manageable; the design implication is white-glove onboarding for the first audit
(highest-leverage retention spend) rather than steady-state support staffing.

### Bottom line on costs

Gross margin at $65 blended ARPU: (65 − ~2 Stripe − <1 variable − ~1 allocated infra) / 65 ≈
**94–96%**. `INFERENCE`, high confidence. **Cost optimization is not a profit lever for this
business at any scale it will reach in the next two years. Every point of profit leverage is on the
revenue side: churn, price, CAC.** This confirms and strengthens pricing.md §5's same conclusion.

---

## 4. Willingness-to-pay signals

1. **The consultant's own fee anchors the audit price.** DueDilio's published band for "Website Due
   Diligence" engagements is $500–5,000 (`EVIDENCE`, carried from `pricing.md`, retrieved
   2026-09-11). A tool that produces the whitelabeled deliverable for that engagement at $49–79
   captures 1.5–10% of engagement value at the low end of the band.
2. **Per-engagement four-figure pricing is live in this exact ecosystem:** Finsider.ai,
   $1,500–4,000/engagement for QoE reports, sold to solo searchers/independent sponsors (§1b) —
   ~6–16% of the $25–35K human deliverable it replaces. `EVIDENCE` + `INFERENCE` on the ratio.
3. **Solo report-professionals pay ~$100–240/mo** for deliverable-generating tools: Spectora
   $109/mo, HomeGauge ~$99/mo, BizEquity ~$240 solo-advisor (§1c). `EVIDENCE`, with the
   usage-frequency caveat noted in §1c.
4. **Per-published-report micro-fees are an accepted pattern:** Spectora Advanced at $3–4 per
   published inspection on top of the subscription (`EVIDENCE`) — precedent that professionals accept
   a metered per-deliverable charge layered on a base plan, i.e., exactly CloseCheck's hybrid shape.
5. **Whitelabel is a paid premium in adjacent markets:** agency reporting tools gate logo-on-PDF at
   ~$85/mo tiers and full custom-domain whitelabel at ~$170/mo tiers; agencies resell branded
   portals/reports at $99–300/mo ([swydo.com](https://www.swydo.com/blog/best-white-label-reporting-tools/),
   [almcorp.com](https://almcorp.com/blog/white-label-client-reporting-agencies/),
   [cloudcampaign.com](https://www.cloudcampaign.com/blog/how-to-price-white-label-saas)). `EVIDENCE`.
   CloseCheck currently bundles whitelabel into the base plan — see lever 3 in §6.
6. **Counter-signal, carried:** DueDilio itself monetizes this population's ecosystem at a $149
   one-time fee, and Content Snare's solo tier is $35/mo (`EVIDENCE`, carried from
   `pricing.md`/`market.md`) — the floor for "what this buyer pays without a deliverable attached"
   is low. The WTP spread ($35/mo floor → $1,500+/engagement ceiling) maps onto whether the tool is
   plumbing (low) or produces the billable deliverable (high). CloseCheck should price as the latter.
   `INFERENCE`.

---

## 5. Against the existing baseline: confirmations, updates, contradictions

Per project convention: contradictions here are flagged for a `spec-writing` pass on `spec.md` §9;
nothing in `pricing.md` or `spec.md` is edited by this file, and superseded reasoning stays visible
in place.

### Confirmed / strengthened

- **Hybrid base + per-audit architecture (pricing.md §1, spec.md §9): confirmed, now with direct
  precedent.** Spectora's subscription + per-published-report add-on and Fathom's per-company tiers
  are live examples of the exact shape pricing.md reasoned its way to. The 2026-09-11 recommendation
  was made without these comparables (WebSearch was down that session); they now exist as `EVIDENCE`.
- **Annual-default billing (pricing.md §3's alternative): upgraded from `INFERENCE` to
  benchmark-backed.** pricing.md reasoned annual billing "plausibly" cuts churn; 2025–26 benchmark
  data says defaulting to annual with a 15–20% discount cuts churn 40–60% (§2). Since pricing.md §6
  showed churn is the variable the whole model is most fragile to, this is now the single
  best-evidenced profit decision available.
- **Margin ~90–98% (pricing.md §5): confirmed and tightened to ~94–96% net of Stripe**, with
  variable cost per audit re-estimated *down* from $1–5 to <$1 (§3).
- **Fixed infra $100–400/mo (pricing.md §5): confirmed as conservative** — Render actuals are
  ~$13–40/mo at launch, ~$60–150/mo at 100–200 customers (§3).
- **No direct competitor at this price point: still holding** (§1d), and the adjacent categories
  (VDR ≥$140/mo, M&A platforms ≥$1,000/mo, QoE ≥$44/mo but financial-only) leave the whitespace
  intact.

### Contradictions / updates — flag for spec.md §9

1. **Per-audit overage $49–79 (spec.md §9 table) now looks underpriced.** CONTRADICTION, moderate
   confidence. New evidence: Finsider.ai's $1,500–4,000/engagement to solo practitioners; the
   6–16%-of-deliverable-value capture ratio; Spectora/BizEquity's ~$100–240/mo from solo report
   professionals; and the $500–5,000 engagement fee this tool's output anchors against. A
   **$99–149/audit** overage (still ≤10% of a mid-band engagement) is defensible and, at ~100%
   margin, flows straight to profit — at 10 audits/year it moves blended ARPU from ~$78 to
   ~$105–135/mo, cutting the customers needed for $3K MRR from ~47 to ~25–30. The Phase 0
   head-to-head price test (spec.md §9's "one number to validate") should test the $99–149 band, not
   only $49–79. The base-subscription band ($29–39) is *not* contradicted — the floor evidence
   (Content Snare $35, DueDilio $149-lifetime) still caps it.
2. **CAC $300–1,000 (pricing.md §5): lower bound optimistic.** PARTIAL CONTRADICTION, moderate
   confidence. 2025 blended B2B SaaS CAC averages ~$1,200 and rose ~14% through 2025 (§2).
   Founder-led outreach to an enumerable list can still beat the average, but planning midpoint
   should move from ~$650 toward **$700–1,200**, and pricing.md §5's LTV:CAC ranges shift
   correspondingly toward their weaker ends — which raises the stakes on levers 1–2 in §6 rather
   than changing the model's structure. (pricing.md itself marked its CAC figure `ASSUMPTION`; this
   is an update to an assumption, not a refutation of evidence.)
3. **Churn assumption 4–8%/mo flat-monthly (pricing.md §5): consistent with 2025–26 benchmarks
   (SMB 3–5%/mo baseline + the cancel-between-deals premium), no contradiction — but the benchmark
   detail that 43% of SMB churn happens in the first quarter** adds a mechanism pricing.md didn't
   have: churn management for CloseCheck is mostly *first-audit onboarding*, not steady-state
   retention. UPDATE, not contradiction.
4. **spec.md §11 success-metric timing (if it assumes fast ramp): calibrate against the 12–18-month
   median to $10K MRR for bootstrapped niche SaaS** (§2). UPDATE — check §11's actual wording during
   the spec pass; flagged here because the 50%-plateau-at-$1–10K-MRR distribution is the honest base
   rate for this business's shape.
5. **Whitelabel bundled free in the base plan (spec.md §9 Solo tier): leaves money on the table
   against adjacent-market practice** (§4 signal 5). UPDATE/lever, not contradiction — pricing.md
   never priced whitelabel separately. Note the spec's Firm tier already gestures at "white-label
   options"; the evidence supports formalizing it lower in the ladder (see lever 3).

---

## 6. Profit-optimization levers, ranked

Ranked by expected profit impact × evidence strength × implementation cost. Levers 1–2 dominate;
everything below them is second-order.

1. **Default to annual billing with a ~17% discount (monthly available but not default).**
   Churn is the variable the model is most fragile to (pricing.md §6's pessimistic case dies on
   churn, not price or CAC), and annual-default is benchmarked to cut it 40–60% (§2). It also
   front-loads cash for a bootstrapped operation and shaves Stripe costs. spec.md §9 already lists
   the annual-credits plan as a "fallback" — the evidence now says it should be the *lead* offer.
   Cost to implement: pricing-page + Stripe configuration only. **Highest-confidence lever.**
2. **Raise the per-audit overage to $99–149 and test it in Phase 0 head-to-head.** Value-anchored to
   the consultant's $500–5,000 engagement fee, precedented by Finsider's per-engagement pricing and
   the 6–16% capture ratio (§1b, §4). Near-100% margin — the raise flows directly to profit and
   roughly halves the customer count needed for any MRR target. Risk: per-audit sticker shock at the
   top of the checkout funnel — mitigated by keeping the 2–3 included audits in the base plan, and
   testable for free in the already-planned Phase 0 pricing conversations. **Highest-impact lever.**
3. **Unbundle full whitelabel into a paid tier (+$30–60/mo).** Keep logo-on-report in Solo; gate
   full brand-kit + custom-domain client portal (the portal exists as of Phase 3) behind a
   Pro/Firm tier, per the $85/mo-vs-$170/mo pattern in agency reporting tools (§4). Whitelabel
   buyers are the most professional, least price-sensitive, lowest-churn segment — this is expansion
   revenue with zero marginal cost. Sequencing note: don't take features *away* from existing paying
   design partners; grandfather them.
4. **Batch overage billing into a monthly rollup invoice** rather than per-audit card charges —
   saves the $0.30 fixed Stripe fee per transaction, avoids a "charged again" felt moment on every
   audit (churn-adjacent), and is how Spectora's per-report add-on bills. Small, cheap, do it when
   metered billing is built.
5. **Spend the support/CS budget on first-audit onboarding, not steady-state support.** 43% of SMB
   SaaS churn lands in the first quarter (§2); for CloseCheck that means a white-glove first audit
   (template pre-selection, a 30-minute walkthrough) is the highest-ROI retention spend available to
   a solo founder. Costs founder time, not money.
6. **Keep unlimited Tier A in the base plan — confirmed nearly free to serve** (<$0.05/run, §3) —
   and instrument it as the expansion trigger: a customer running Tier A checks on new domains is a
   customer with a deal in the pipeline; that's the moment to surface the full-audit upsell. (Build
   note: keep Tier A on RDAP-era APIs, per the WHOIS-sunset finding in §3.)
7. **Template add-ons as a later expansion layer** (per-business-type template packs, following
   Canopy's $10–34 per-client add-on and Financial Cents' $5/client/mo pattern, `EVIDENCE` carried
   from pricing.md §1). Deferred to last: it fragments the catalog while the template library is
   still the core value story, and the audit-methodology templates are the product's IP moat —
   monetize breadth only once 3–4 templates are validated in real audits.
8. **Do not spend effort on infrastructure cost optimization.** Anti-lever, stated to close the
   question: at ~2% of revenue, halving infra cost moves profit less than one customer's worth of
   MRR. Every optimization hour belongs on levers 1–3 and CAC-side content/SEO (the enumerable-list
   outreach advantage from pricing.md §5 still holds; the ~$1,200 CAC benchmark is the number to
   beat, and niche content targeting "technology due diligence checklist" queries — which §1 of
   `market.md` showed are won today by static-template vendors — is the cheapest wedge).

---

## Sources

- https://ctacquisitions.com/best-quality-of-earnings-software-2026/ — 10-vendor QoE software pricing comparison
- https://finance.yahoo.com/news/quality-earnings-software-launched-finsider-162500493.html — Finsider.ai launch
- https://www.bdemerson.com/article/quality-of-earnings-report-cost, https://www.bedrockqoe.com/insights/quality-of-earnings-report-cost — human QoE report cost bands
- https://www.datarooms.co/pricing/dealroom, https://www.tryplox.com/blog/dealroom-pricing — DealRoom pricing
- https://www.softwareadvice.com/collaboration/midaxo-profile/, https://www.vendr.com/marketplace/midaxo — Midaxo pricing
- https://www.papermark.com/blog/virtual-data-room-cost, https://www.peony.ink/blog/virtual-data-room-cost-guide — VDR pricing landscape
- https://poolverify.io/resources/spectora-pricing-breakdown-comparison, https://www.capterra.com/p/157144/Spectora/, https://inspectordata.com/blog/homegauge-vs-spectora-comparison.html — home-inspection software pricing
- https://unbroker.com/best-business-valuation-software-for-non-financial-experts-2025/, https://investimon.com/top-10-best-business-valuation-software-tools-for-2025-ranked-reviewed/ — BizEquity/valuation software pricing
- https://optif.ai/learn/questions/b2b-saas-churn-rate-benchmark/, https://www.venasolutions.com/blog/saas-churn-rate, https://www.wearefounders.uk/saas-churn-rates-and-customer-acquisition-costs-by-industry-2025-data/ — churn/CAC benchmarks
- https://baremetrics.com/blog/annual-vs-monthly-pricing-better-retention, https://www.growthspreeofficial.com/blogs/b2b-saas-annual-contract-length-multi-year-discount-benchmarks-2026-impact-on-retention-payback, https://dodopayments.com/blogs/annual-vs-monthly-billing-saas — annual-billing benchmarks
- https://www.flowjam.com/blog/27-micro-saas-examples-that-actually-print-money-in-2025, https://www.softwareseni.com/solo-founder-saas-metrics-from-0-to-10k-mrr-in-6-months-with-realistic-timelines/ — solo-founder SaaS revenue distribution
- https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses, https://kuberns.com/blogs/render-pricing/, https://livemy.app/blog/render-pricing — Render pricing
- https://www.whoxy.com/pricing.php, https://whoisjson.com/pricing, https://rdapapi.io/blog/whois-api-alternatives — WHOIS/DNS/SSL API costs and WHOIS sunset
- https://www.swydo.com/blog/best-white-label-reporting-tools/, https://almcorp.com/blog/white-label-client-reporting-agencies/, https://www.cloudcampaign.com/blog/how-to-price-white-label-saas — whitelabel premium pricing patterns

## Saved to

`docs/research/profitability.md`
