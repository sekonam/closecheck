# Competitor map — CloseCheck

B2B SaaS selling structured technology due-diligence audit workflows (checklist engine, report
generation, client portal, template library by business type) to M&A/QoE/IT due-diligence
consultants and small advisory firms assessing $200k–2M small-business acquisitions. Sold to the
**provider** (consultant/firm), not the deal-side buyer — the reframe recorded in
`docs/idea.md`.

Retrieved 2026-09-11. `WebSearch` tool budget was exhausted session-wide before this task started
(confirmed: "200 of 200" on the first five parallel calls, mirroring the same exhaustion the sibling
`webdevprofit` workspace hit on 2026-09-11). All retrieval below is via direct `WebFetch` on named
vendor pages, or `r.jina.ai` wrapping `lite.duckduckgo.com/lite` (the documented workaround in
`~/dev/webdevprofit/docs/method-notes.md`) where a search was needed. Plain Google and Bing fetches
returned consent walls / geo-mismatched (Polish) results and are not used as evidence anywhere below.
Several direct fetches (Notion template gallery, G2/Capterra category pages, Etsy search, Midaxo
pricing) returned HTTP 403/404 and are marked `BLOCKED`, not read as zero.

This map also inherits and cross-checks two facts already established with primary sourcing in the
sibling `webdevprofit` research on the parent candidate
(`~/dev/webdevprofit/research/bizbuysell-main-street-tech-audit/`), re-verified live in this session
via direct `WebFetch`: DueDilio's own published scale and pricing, and QoE's explicit exclusion of
technology diligence.

---

## 1. Verdict

**Thin, bordering on empty — and the empty parts look structural, not undiscovered.** No
purpose-built technology-DD *software* (checklist engine + report generator + client portal) sold to
independent consultants exists in any layer searched. What exists instead: one direct
*service* competitor doing the identical work by hand at low-four-figure fixed prices (AuditCraft),
one financial-DD *software* analog proving the "sell software to DD consultants" model is viable but
unbuilt for tech (Finsider.ai), a marketplace (DueDilio) with zero visible sign of building
provider tooling, and a deep bench of generic practice-management/client-portal software
($19–150/user/month) that already does 60–70% of the workflow-and-portal job for a fraction of what
a DD-specific tool would need to charge to be viable.

## 2. Landscape table

| Competitor | Layer | Price (dated) | Buyer | Scale | Main weakness / relevance |
|---|---|---|---|---|---|
| **AuditCraft** (auditcraft.org) | Direct — but a *service*, not software | Core Assessment **$2,500** (5 business days), Extended **$4,500** (7 business days) — fixed fee, no hourly billing. Retrieved 2026-09-11 via direct `WebFetch`. `EVIDENCE` | Deal-side buyers directly ("searchers, independent sponsors, and small PE firms"), $500K–$10M deals | No headcount/founding date disclosed; positions against "$25,000+ minimums" PE-focused firms | This is the closest thing to a named direct competitor for the *underlying work* CloseCheck's software would structure — but it is a boutique doing the audit by hand, with **no SaaS platform, no tools sold to other consultants, no white-label** (confirmed absent on their own site). It validates the price band and the workflow (fixed-fee, tiered, findings-report deliverable) without being a software competitor at all. |
| **Finsider.ai** | Adjacent tool — closest software analog, wrong scope | Not disclosed (contact-sales pattern, no pricing page found). Retrieved 2026-09-11. `EVIDENCE` (positioning), `INFERENCE` (pricing model) | M&A/QoE consultants and advisory firms — explicitly billable-hours-reduction framing for firms, not deal-side buyers | "50+ integrations," no customer count or funding disclosed | Proves the exact business model CloseCheck is betting on — software sold *to diligence professionals*, not to deal-side buyers — already exists and is funded enough to build 50+ integrations. But it automates **financial** DD (QoE), not technology DD. No evidence found that it or any comparable vendor has moved into technology/IT scope. |
| **DueDilio** | Marketplace / distribution, not a competitor on its own tools | Buyer-side: free to browse, **$149 one-time lifetime** to post projects/hire (retrieved 2026-09-11, direct `WebFetch`). Technology DD category itself: **Website Review $500–$5,000**, Software Code Review $4,000–$10,000, Cybersecurity $6,000–$20,000, IT Strategy & Roadmap $2,000–$10,000 (carried from prior verified fetch, `~/dev/webdevprofit` research, re-confirmed live 2026-09-11) | Buyers post projects; 200+ vetted providers fulfil them | 200+ providers, 1,300+ projects, $3B+ cumulative deal value, 4.9★ Trustpilot | **No mention anywhere on the site (homepage, technology-DD page, or blog) of provider-facing software, tools, or a platform for their vetted consultants.** The marketplace is buyer-facing only; providers are external contractors who show up with their own methods. See §4 for the structural-risk read. |
| **Content Snare / SuiteDash / Assembly (Copilot)** | Generic substitute — client intake + portal | Content Snare $35–$215/mo (annual); SuiteDash $19–$99/mo flat (unlimited users); Assembly $20–$90/mo. All retrieved 2026-09-11, direct `WebFetch`. `EVIDENCE` | Solo practitioners and small firms across accounting, legal, consulting, agencies | Established, multi-year products with named accountant/consultant user bases | These solve the **document-collection-from-client + branded portal** half of CloseCheck's scope generically, cheaply, and already. None have a technology-DD checklist engine, business-type template library, or traffic-light findings report — but a consultant who already owns one of these for client work has no forcing reason to add a second tool just for the portal/collection piece. |
| **Karbon / Financial Cents / Canopy** | Generic substitute — accounting-firm workflow + portal | Karbon $59–$99/user/mo; Financial Cents $19 (solo)–$89/user/mo; Canopy $74–$149/user/mo (all annual, retrieved 2026-09-11, direct `WebFetch`). `EVIDENCE` | Accounting/tax practice owners, solo to 200+ person firms | Karbon claims "$39,191 saved per employee/year" in its own marketing; Financial Cents claims 56 hrs/mo, $19,200/yr saved | Same substitution risk as above, one level removed: these are accounting-practice tools, not M&A-specific, but a QoE-adjacent consultant who is also a CPA (a real overlap population) may already run their whole practice through one of these and would need a specific reason to add a DD-only tool on top. |
| **DealRoom / Devensoft / Ansarada** | General DD/deal-workflow software — but enterprise, confirmed out of segment | DealRoom: no published price, "priced by deal volume," annual commitment, contact-sales (retrieved 2026-09-11). Devensoft: no pricing published, contact-sales only. Ansarada: **$479–$8,579/month**, storage-tiered, quote-based "per deal or subscription, for advisers and corporates" (retrieved 2026-09-11, via proxy search). `EVIDENCE` | DealRoom: "M&A industry leaders," 350+ enterprise customers (Emerson, Belden, Energizer). Devensoft: enterprise M&A teams. Ansarada: advisers/corporates running data-room-scale deals | DealRoom 350+ logos; others undisclosed | Confirms the task's premise directly: **no dedicated small-firm/solo-consultant tier exists** among the named general DD-workflow platforms. Ansarada's cheapest published floor ($479/mo) alone exceeds what a solo consultant billing $2,500–4,500 per audit (AuditCraft's anchor) could rationally spend on a single deal's data room. Midaxo's pricing page returned HTTP 404 — `BLOCKED`, not confirmed absent. |
| **Notion / Gumroad / Etsy DD-checklist templates** | Free/cheap open-supply substitute | Notion templates: price not disclosed on template pages (several free). Gumroad "SME Due Diligence Checklist — AI-Ready" and Etsy "M&A Due Diligence Checklist" listings found, prices not extracted (retrieved 2026-09-11 via proxy search). `EVIDENCE` (existence), `INFERENCE` (low price, typical of the category) | Individual consultants, analysts, self-directed buyers | Unmeasured — no review/sales counts surfaced | These are static checklists, not workflow software: no report generation, no client portal, no tier-based methodology (Tier A/B/C from external/no-cooperation through live-access verification), no business-type template library. They are the honest "free and 80% as good" floor for the *checklist content* alone, not for the software layer CloseCheck actually sells. |
| **The status quo** | Status quo | Free | Consultants who currently turn away tech-assessment requests, or do them ad hoc in a Word doc / spreadsheet | Universal — the default for every consultant not using a named tool above | Per the parent research (`bizbuysell-main-street-tech-audit`), the best-positioned incumbent in this exact deal-size band (Rapid Diligence, 250+ deals/5 years) never built a tech-review SKU at all. The status quo for most QoE/M&A generalists is: don't offer technology diligence, or bolt a checklist item onto the existing engagement with no repeatable tooling behind it. |

## 3. The gap

The gap is narrower than "no technology-DD software exists" — it's specifically: **no one has
packaged the AuditCraft-style workflow (fixed-tier, findings-report, sub-$5K price point, small-deal
scope) as reusable software a *third-party* consultant could run, the way Finsider.ai did for
financial DD.** Three things have to be true simultaneously for this gap to be real rather than
undiscovered, and the evidence supports two of the three cleanly:

1. **The underlying service demand is real and priced** — AuditCraft's $2,500/$4,500 fixed fees for
   exactly this deal-size band ($500K–$10M) and DueDilio's $500–$5,000 "Website Review" line both
   confirm buyers pay for this work today, done by hand, one engagement at a time. `EVIDENCE`.
2. **No software vendor has moved from doing the work to selling the tool** — Finsider.ai did this
   exact move for financial DD (QoE) and found a fundable niche (50+ integrations, firm-level
   billable-hours pitch); nothing found does the equivalent for technology DD. `EVIDENCE of absence`
   across a materially independent search pass (DealRoom, Devensoft, Ansarada, AuditCraft,
   SMBDiligence, L40, plus the DDG-proxy sweep specifically for "IT due diligence" + "software" +
   "SMB acquisition").
3. **Generic tools don't fully close it, but they close more than half of it** — Content
   Snare/SuiteDash/Karbon-class tools already give a consultant client intake, document collection,
   a branded portal, and generic workflow automation for $20–150/month. What they do **not** provide
   is the domain-specific payload: a technology-DD-specific checklist taxonomy (the Tier
   A/B/C — external, seller-provided, live-access — methodology from `docs/idea.md`), a
   business-type template library (restaurant POS/ordering, salon booking, franchise-mandated
   stacks), or a traffic-light findings report built for this specific audience. This is the real
   competitive test CloseCheck has to pass: **is the domain-specific 30–40% worth a dedicated
   subscription on top of a portal tool most consultants may already own?** Untested here —
   `ASSUMPTION`, and the cheapest resolution is a pricing/willingness-to-pay conversation with 10–15
   DueDilio-listed or AuditCraft-adjacent providers, not more competitor search.

## 4. Why incumbents cannot just close it — or could they, easily?

**DueDilio is the one with both the motive and the means, and the absence of any visible move is
worth naming plainly rather than treated as permanent.** It already has the exact buyer list
CloseCheck needs (200+ vetted providers, many of whom by definition already field technology-DD
requests), the marketplace relationship that would make a bundled tool a retention lever ("stay
vetted, get free/discounted workflow software"), and — per its own published fee data — direct
visibility into what those providers charge and how they scope engagements. Nothing on
duedilio.com (homepage, technology-DD page, blog, retrieved 2026-09-11) mentions provider tooling,
but **a marketplace building software to lock in its own supply side is a well-worn pattern**
(Upwork's project catalog and workflow tools, Toptal's internal delivery tooling), and DueDilio has
not done it yet — that is evidence of timing, not evidence they structurally cannot. This is the
single biggest named risk to CloseCheck's distribution plan (per `docs/idea.md`'s own open question
about reaching the 200+ DueDilio-listed providers directly): **if CloseCheck's go-to-market runs
through DueDilio's provider list, DueDilio itself is the most plausible entity to build a competing
tool and offer it for free as a provider-retention feature**, not a competing SaaS vendor.

**AuditCraft could build this for itself faster than CloseCheck could sell to them,** since they
already run the exact methodology CloseCheck is packaging — but building internal tooling and
selling it externally as a multi-tenant SaaS to competitors is a different, distracting business for
a boutique service shop; no evidence found (no software product, no white-label offer on their own
site) that they have made or plan that move.

**Finsider.ai could extend from financial to technical scope** with materially less work than a new
entrant building both from zero, since they already have the buyer relationship (M&A/QoE firms),
the report-generation and client-delivery infrastructure, and integration plumbing. This is the
second most plausible "incumbent closes the gap" path and, like DueDilio, is untested — no
technology-DD feature, roadmap mention, or acquisition was found on their site.

**Karbon/Canopy/Financial Cents cannot close it without becoming a different product.** Their
entire go-to-market and feature set is built around recurring accounting-cycle work (tax season,
bookkeeping, client onboarding cadence), not one-off, tiered, deal-triggered audits. Adding a
technology-DD checklist template to their library is trivial for them technically; positioning it
to the DD-consultant buyer, who is not their core accounting-firm customer, is not.

## 5. Price anchors

| Anchor | Price | What it's for |
|---|---|---|
| AuditCraft | $2,500 / $4,500 fixed | The full service delivery this software would structure — the ceiling on what a consultant nets per audit before their own margin, and the number CloseCheck's subscription/usage fee has to look cheap against |
| DueDilio "Website Review" | $500–$5,000 | Narrower technology-DD line item, same deal-size population, marketplace-published |
| DueDilio broader technology DD (Code Review, Cybersecurity, IT Strategy) | $2,000–$20,000 | Upper end of what this buyer population pays for technology diligence generically |
| QoE (financial DD, same deal band) | $8,000–$15,000 median $12,000 | The adjacent, better-established spend this buyer already makes — the number that trains the consultant's own sense of "reasonable diligence fee" |
| SuiteDash / Assembly / Content Snare | $19–$215/month | What this exact buyer (solo-to-small consulting practice) is already trained to pay for portal + workflow software generically — this, not enterprise DD software, is the realistic subscription-price ceiling for CloseCheck unless the domain-specific payload can justify a premium |
| Ansarada (enterprise VDR floor) | $479–$8,579/month | The floor of "real" deal-software pricing once you cross into enterprise VDR territory — confirms this is a different, higher-ACV market CloseCheck should not try to price against |
| Karbon / Canopy | $59–$149/user/month | What the accounting-firm-practice-management substitute costs, for the overlap population that is also a CPA |

## 6. Answers to the five tasked questions

1. **General DD/deal-workflow software for small firms/solo consultants:** not found. DealRoom,
   Devensoft, and Ansarada are all enterprise-priced or enterprise-positioned (350+ enterprise
   logos, custom/contact-sales pricing, or a $479+/month floor). Midaxo's pricing page 404'd —
   `BLOCKED`, not confirmed. No vendor found markets explicitly to independent consultants or small
   advisory shops in this layer.
2. **Technology/IT-assessment-specific tools for the SMB-deal-size market:** one direct service
   competitor (AuditCraft, $2,500/$4,500 fixed fee, $500K–$10M deals) doing the work by hand with
   **no software product**. No purpose-built technology-DD SaaS found at any price point.
3. **Generic tools consultants might already use instead:** yes, and they cover more ground than a
   pre-mortem might assume — Content Snare/SuiteDash/Assembly for client portal + document
   collection ($19–215/mo), Karbon/Financial Cents/Canopy for the CPA-overlap population's broader
   practice workflow ($19–149/user/mo), and free-to-cheap Notion/Gumroad/Etsy checklists for the
   raw content. They do **not** provide the domain-specific checklist taxonomy, tiered methodology,
   business-type template library, or traffic-light report format — but they remove roughly the
   generic half of the job cheaply, which sets a low price ceiling on what CloseCheck can charge for
   the domain-specific half alone.
4. **DueDilio building provider tooling themselves:** no evidence found that they have started or
   announced this (homepage, technology-DD page, and blog all checked, 2026-09-11). But they hold
   the strongest structural position to do so — existing provider relationship, visibility into
   provider pricing and scope, and a plausible retention motive — making this the single largest
   named distribution risk if CloseCheck's go-to-market runs through DueDilio's provider list, not a
   currently-active competitor.
5. **Generic report-generation + client-portal SaaS reducing DD-specific differentiation:** yes,
   materially. SuiteDash, Assembly, and Content Snare all already deliver white-labeled client
   portals and document collection to solo/small consulting practices for $19–215/month. Finsider.ai
   goes further and proves report generation specifically for M&A diligence deliverables is already
   sold as software to this buyer — just for financial scope, not technical. This is the strongest
   single argument for keeping CloseCheck narrow (the domain-specific checklist engine, tier
   methodology, and template library) rather than competing on the generic portal/report layer where
   established, cheap incumbents already have years of feature depth.

## Saved to

`/Users/s.prykhozhai/dev/closecheck/docs/research/competitors.md` (this file).
