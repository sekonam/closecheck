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
   objects — not free-text notes.
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
| **Consultant Org** | The paying account — a solo consultant or firm. Has seats, a plan, and a brand kit (logo, color, report footer) for whitelabeled output. |
| **Engagement** | One acquisition deal being diligenced. Belongs to a Consultant Org. Has a target business, a deal stage (pre-LOI / post-LOI / closing), and one Audit. |
| **Template** | A versioned checklist definition for a business type (see §5). Defines which checklist items exist, which tier each belongs to, and how each is scored. Templates are shared, product-owned content — a consultant selects one per Engagement, and may add engagement-specific custom items but cannot edit the shared template from inside an engagement. |
| **Audit** | One run of a Template against one Engagement. Holds the state of every checklist item: not started / in progress / pass / fail / not applicable / blocked (seller cooperation not yet available), plus evidence (notes, uploaded documents, screenshots) per item. |
| **Finding** | A checklist item's resolved state plus its evidence and severity. The unit that renders into the Report. |
| **Report** | Generated, versioned, exportable output of an Audit at a point in time. See §6. |
| **Client Portal Link** | A scoped, revocable read-only view of a Report for the buyer. See §7. Phase 3+. |

## 4. The three tiers (detailed)

Carried forward from `research/bizbuysell-main-street-tech-audit/build.md` via `idea.md`, expanded
into an implementable structure. Each checklist item in a Template declares:

- **Tier** (A/B/C) — see below
- **Method** — `automated` (system runs a check with no human input) or `manual` (consultant records
  a finding by hand, optionally attaching evidence)
- **Severity model** — traffic light (Green / Yellow / Red) plus a free-text finding note; Red items
  require a note, Yellow items recommend one, Green items don't need one
- **Blocking dependency** — whether the item requires deal-stage access the consultant may not have
  yet (relevant to Tier B/C)

### Tier A — external, no seller cooperation needed

Runnable pre-LOI, even pre-offer, from public information only.

| Item | Method |
|---|---|
| Domain/registrar ownership and expiration | automated (WHOIS) |
| DNS provider and hosting fingerprint | automated |
| SSL/TLS certificate validity, issuer, expiration | automated |
| CMS identification and version/patch status (e.g. outdated WordPress plugin) | automated, best-effort |
| Email authentication posture (SPF / DMARC records; DKIM best-effort — see note) | automated (added 2026-09-21, §13.1) |
| Mail provider fingerprint (MX records — who hosts the business's email) | automated (added 2026-09-21, §13.1) |
| HTTPS hygiene (HTTP→HTTPS redirect enforced; HSTS observed) | automated (added 2026-09-21, §13.1) |
| Google Business Profile ownership and claim status | manual (no reliable public API for claim status) |
| Social account ownership (which accounts exist, who administers them per public info) | manual |
| Trademark conflict scan on business name / domain | manual, consultant-triggered (search, not filed automatically) |

DKIM note (methodology constraint, not an implementation detail): DKIM records live under
per-provider selector names that cannot be enumerated from public DNS, so the check probes common
selectors (`google`, `selector1/2`, `k1`, …) best-effort. A found record is evidence; a not-found
result is **not** evidence of absence and must never lower a severity on its own — the finding note
says what was probed and defers to SPF/DMARC (which are deterministically checkable) for scoring.

Tier A is the automation surface. It's also the free/first-touch surface: a consultant can run Tier A
on a prospective deal before they've even been engaged, which is a plausible top-of-funnel hook (see
`roadmap.md` Phase 1).

### Tier B — seller/broker-provided documents

Requires the seller or broker to hand over documents; typically available once diligence has formally
started (post-LOI in most deals, sometimes earlier if broker is cooperative).

| Item | Method |
|---|---|
| POS system contract terms, term length, early-termination penalty | manual, document upload + structured fields |
| Online-ordering / booking platform contract and transferability clause | manual, document upload + structured fields |
| Payment processor account standing (chargebacks, holds, reserve) | manual, document/statement upload |
| Recurring SaaS inventory: what tools, what each costs, transfers vs. must-rebuild | manual, structured table the consultant fills from seller-provided list |

Tier B items are inherently document-heavy. The product's job is to turn "here's a PDF contract" into
a structured, comparable finding (transferable: yes/no/unclear, penalty: $X or Y% of ARR) rather than
just storing an attachment.

### Tier C — live access verification

Highest friction, often deferred until very late pre-close or handled at closing itself. Requires
actual login credentials to seller-controlled systems.

| Item | Method |
|---|---|
| Live login to hosting/CMS admin | manual, consultant performs the check outside the product; product records pass/fail + notes |
| Live login to POS/booking/GBP/socials | manual, same pattern |
| Data-export test (can the buyer actually get their data out) | manual, same pattern |

**Product decision:** CloseCheck does **not** accept, store, or proxy live third-party credentials in
v1. Tier C items are recorded as consultant-attested findings (the consultant did the login themselves,
in their own browser/session, and reports the result) rather than the product performing an in-app
credential-based check. This removes the single largest trust/security liability from the MVP and can
be revisited only if a design partner explicitly needs credential handoff and a proper secrets-vault
architecture is built for it — not before. See §8.

## 5. Template library

One Template per business type, each a curated subset/superset of the tier structure above plus
type-specific items:

| Template | Distinguishing items beyond the base checklist |
|---|---|
| Restaurant with online ordering | POS-to-ordering-platform integration health, third-party delivery platform (DoorDash/UberEats) account ownership and menu sync |
| Salon/service business with booking | Booking software client-data export format, recurring membership/package liability transfer |
| Franchise location (any vertical) | Franchisor-mandated tech stack compliance (can the buyer even choose a different vendor), franchise-system SSO/account transfer process |
| General e-commerce | Platform (Shopify/WooCommerce/etc.) ownership transfer mechanics, app/plugin inventory and licensing, payment gateway PCI scope |

**MVP scope:** ship with **one** template (Restaurant with online ordering — the highest-evidence
vertical in the source research) fully built, and the base tier structure factored so the remaining
three are additive, not rewrites. See `roadmap.md` Phase 2 for sequencing.

Templates are versioned (`v1`, `v2`, ...). An in-progress Audit stays pinned to the Template version
it started on; only new Audits pick up a new Template version. This matters because mid-engagement
checklist changes would silently invalidate a consultant's already-recorded findings.

## 6. Report generation

- **Structure:** cover (business name, engagement date, consultant/firm branding) → executive summary
  (one traffic-light row per tier, plus an overall rating) → tiered findings detail (grouped by tier,
  each finding showing status, severity, note, evidence) → appendix (raw uploaded documents, if the
  consultant opts to include them).
- **Severity roll-up:** overall Audit rating = worst tier rating; tier rating = worst item rating
  within that tier, with an explicit rule that any single Red item makes its tier Red regardless of
  how many Greens surround it. Consultants can override the computed overall rating with a manual
  note explaining why (e.g., a Red item they've independently judged immaterial) — the override is
  always shown alongside the computed rating, never silently replacing it.
- **Export formats:** PDF (v1, primary — this is what gets emailed/handed over in a deal), shareable
  link (Phase 3, see §7).
- **Whitelabeling:** consultant's logo, name, and color accent on the cover and footer of every page.
  No CloseCheck branding on the primary export in paid plans (see `docs/releases.md` for whether this
  is plan-gated).
- **Liability language:** every report includes standard disclaimer language (audit reflects
  information available at the stated date; not a substitute for legal/financial diligence) —
  required review by the consultant, not optional boilerplate the product silently inserts without
  them seeing it. Any change to this language is a legal-review item, not a routine content edit —
  flag it rather than edit it directly (see the `spec-writing` skill).

## 7. Client-facing portal (Phase 3+, not MVP)

**Status update:** built (2026-09-18), ahead of the design-partner evidence this section originally
called for, per explicit user direction to build through Phase 3 regardless — see
`docs/roadmap.md` Phase 3's matching note. The rationale below is preserved as the reasoning that was
superseded, not deleted, per this project's `spec-writing` convention for resolved-but-overridden
sections. The implementation matches the "magic-link, no account required" shape this section
specifies: `src/app/portal/[token]/page.tsx`, `src/lib/actions/portal.ts`.

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
  data at rest. Default retention: tied to the Engagement lifecycle, with a consultant-configurable
  deletion policy (e.g., auto-purge N days after the Engagement is marked closed/dead). No indefinite
  default retention.
- **Audit logging:** who viewed/exported/shared a given Report and when, per Engagement — this is
  itself a feature consultants can point to when a buyer's advisory team asks "who's had access to
  this."
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
  first engagement using the product.
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
