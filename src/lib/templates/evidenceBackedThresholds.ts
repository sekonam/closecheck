/**
 * Template v4 — "evidence-backed thresholds".
 *
 * WHAT THIS VERSION CHANGES
 * -------------------------
 * v3 gave every manual item a verification procedure and a severity rubric. Those rubrics were
 * written from domain knowledge, and several of their numbers were wrong — not arguable, wrong
 * against the current published sources (docs/research/audit-thresholds-2026-09.md, retrieved
 * 2026-09-22). v4 replaces them with thresholds that name their source, and deletes the ones that
 * turn out to have no source at all.
 *
 * The corrections that actually move a rating:
 *   1. TLS. v3 said "Yellow if it expires inside 30 days". A fixed day count is now the wrong
 *      *shape*: the CA/Browser Forum capped certificate lifetime at 200 days from 2026-03-15 (100
 *      from 2027-03-15, 47 from 2029-03-15), Let's Encrypt and Certbot 4.0.0 both moved to renewing
 *      at one third of lifetime remaining, and Let's Encrypt issues six-day certificates on which
 *      two days remaining is healthy. A 30-day rule fires on correctly-operating automated renewal.
 *   2. Payment processors. v3 said to "check the current Visa and Mastercard programme thresholds".
 *      Right instinct, and now specific: VDMP/VFMP were retired on 2025-04-01 and replaced by VAMP,
 *      whose merchant Excessive threshold is 150 bps from 2026-04-01 above a 1,500 monthly event
 *      floor — a floor no business in this deal band reaches, which reframes Visa exposure as an
 *      acquirer-relationship risk. Mastercard's ECM (100 chargebacks and 150 bps, on a
 *      *previous-month* denominator) is the programme that bites here, and MATCH Code 04 — 1% of
 *      Mastercard sales and USD 5,000, five years, attaching to the principal personally — is the
 *      strongest Red candidate in payment diligence at this size. It gets its own item.
 *   3. Trademark. v3 rated on Nice class ("similarity only matters within the same class"). TMEP
 *      §1207.01(d)(v) says the opposite: classification "has no bearing on the question of
 *      likelihood of confusion" — the identification wording controls. That is a rating rule, not a
 *      wording preference, so the enum that encoded it changes too.
 *   4. Email authentication. DMARC is RFC 9989 (Standards Track, May 2026) and `pct=` is gone;
 *      5,000/day is Google's and Microsoft's published bulk threshold and NOT Yahoo's, which
 *      publishes none; and DKIM cannot be graded from guessed selectors at all — which is why v4
 *      adds a manual companion item holding the one artifact that can grade it.
 *   5. Domain. The 60-day ICANN transfer lock still applies today (the revision removing it was
 *      adopted 2026-06-07 with no effective date). No authoritative days-to-expiry threshold exists
 *      for a domain, so v4 states CloseCheck's own derivation and labels it as such.
 *   6. Data export. Square masks customer contact details, so a customer count overstates the
 *      contactable list — a valuation input, captured as its own field. Toast gives 60 days after
 *      closure, 48 months of history, six months per pull and no single export, which makes
 *      extraction a pre-close condition rather than a post-close task.
 *
 * THE STANDING RULE FOR THIS CONTENT
 * ----------------------------------
 * An uncited threshold is worse than no threshold in a deliverable a consultant bills $2,500–4,500
 * for. Where the research found no authoritative source (reserve percentages, "letter of good
 * standing", cert-expiry day counts, domain-expiry day counts, registrar restore fees), the
 * guidance says so and gives the consultant the reasoning and the retrieval method instead of a
 * number. Where a threshold is revised periodically — the card-network programmes, the ICANN
 * Transfer Policy implementation status, the CA/B validity schedule — the guidance says to
 * re-verify at the audit date and to state which version was applied.
 *
 * WHY THIS IS A SEPARATE ARRAY AND NOT AN EDIT
 * -------------------------------------------
 * docs/spec.md §5: an in-progress Audit stays pinned to the Template version it started on, because
 * a mid-engagement checklist change would silently invalidate findings a consultant already rated.
 * So v1/v2 content in content.ts and the v3 enrichments in evidenceDepth.ts are frozen — including
 * the defects listed above — and the corrections arrive as a new version, layered on the v3 item
 * set exactly the way v3 layered on v1/v2. An audit rated against v3's 30-day certificate rule was
 * rated against that rule, and its finding stays readable against it.
 */

import { BlockingDependency, CheckMethod, EvidenceExpectation, Tier } from "@prisma/client";

import { TEMPLATE_DEFINITIONS } from "./content";
import { buildEvidenceDepthItems } from "./evidenceDepth";
import type { ItemFieldSchema } from "./fieldSchema";
import type { TemplateItemInput } from "./publish";

const YES_NO_UNCLEAR = ["yes", "no", "unclear"] as const;
const TRANSFERABILITY = ["transfers", "consent-required", "does-not-transfer", "unclear"] as const;

// ---------------------------------------------------------------------------
// Field schemas revised or introduced in v4
// ---------------------------------------------------------------------------

/**
 * Replaces v3's single `chargebackRate` / `chargebackCount` pair.
 *
 * One "chargeback rate" cannot carry this rating, because the two networks compute different
 * numbers from different denominators: Visa's VAMP ratio is (TC40 fraud reports + TC15 disputes) ÷
 * settled card-not-present transactions, while Mastercard's CTR divides a month's chargebacks by
 * the *preceding* month's sales. The lagged denominator mechanically inflates the ratio for a
 * seasonal or declining business, which is why the same-month recomputation is a field and not a
 * note. Counts matter as much as ratios: both network programmes require a count floor AND a ratio.
 */
const PAYMENT_STANDING_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "processor", label: "Processor / acquirer", kind: "text", placeholder: "e.g. Square, Stripe, Elavon" },
    {
      key: "statementPeriod",
      label: "Statement period reviewed",
      kind: "text",
      placeholder: "e.g. Sep 2025 – Sep 2026",
      help: "13 months is what this rubric assumes: it covers a full seasonal cycle and Mastercard's previous-month denominator for the first month you rate.",
    },
    {
      key: "vampRatio",
      label: "Visa VAMP ratio, worst month",
      kind: "percent",
      placeholder: "e.g. 0.45",
      help: "(TC40 fraud reports + TC15 disputes) ÷ settled card-not-present transactions, per Visa's published formula. Card-not-present only — a restaurant or salon sits largely outside it.",
    },
    {
      key: "mcChargebackCount",
      label: "Mastercard chargebacks, worst month",
      kind: "text",
      placeholder: "e.g. 41",
      help: "The count floor is as load-bearing as the ratio: Mastercard's ECM needs 100–299 chargebacks AND 150–299 bps in the same month.",
    },
    {
      key: "mcCtrLagged",
      label: "Mastercard CTR, worst month (previous-month denominator)",
      kind: "percent",
      help: "Computed the way Mastercard computes it: that month's chargebacks ÷ the PRECEDING month's sales transactions.",
    },
    {
      key: "mcCtrSameMonth",
      label: "Same-month CTR for the same month",
      kind: "percent",
      help: "Recompute same-month and show the client both. A materially higher lagged ratio on a seasonal or declining business is a denominator artifact, not deteriorating dispute behaviour.",
    },
    { key: "reserveHeld", label: "Reserve currently held", kind: "money" },
    {
      key: "deflectionInUse",
      label: "Pre-dispute deflection / CE3.0 in use",
      kind: "enum",
      options: ["none", "deflection-only", "ce3-only", "both", "unclear"],
      help: "Visa excludes disputes deflected through RDR, Order Insight or Ethoca and TC40s qualifying for Compelling Evidence 3.0. Remove them post-close and the reported ratio rises with no change in behaviour.",
    },
    {
      key: "accountStatus",
      label: "Account standing",
      kind: "enum",
      options: ["good-standing", "reserve-held", "written-notice-received", "under-review", "terminated", "unclear"],
    },
  ],
};

/**
 * New in v4. The MATCH question is not answerable from statements — it is a representation, an
 * acquirer inquiry, or nothing — so bundling it into "account standing" put the deal-threatening
 * finding and the housekeeping findings behind one severity, which §6's roll-up cannot separate.
 */
const TERMINATED_MERCHANT_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "listingStatus",
      label: "MATCH / VMSS status",
      kind: "enum",
      options: [
        "confirmed-not-listed",
        "confirmed-listed",
        "inquiry-pending",
        "seller-declined-to-inquire",
        "unclear",
      ],
      help: "Merchants cannot search MATCH themselves. The routes are the acquirer, or matchbusinessowner@mastercard.com.",
    },
    {
      key: "principalsCovered",
      label: "Principals covered by the inquiry / representation",
      kind: "text",
      placeholder: "names of every principal owner",
      help: "A MATCH record carries the principal owner's name, address, phone and tax ID — the entity's status alone does not answer this.",
    },
    {
      key: "principalRetainedPostClose",
      label: "A listed-or-unverified principal stays involved after close",
      kind: "enum",
      options: [...YES_NO_UNCLEAR],
      help: "As operator, guarantor or on an earn-out. This is what turns a listing from the seller's problem into the buyer's.",
    },
    {
      key: "representationObtained",
      label: "Representation in the purchase agreement",
      kind: "enum",
      options: ["given", "refused", "not-yet-requested", "unclear"],
    },
    { key: "observation", label: "What was established, and how", kind: "longtext" },
  ],
};

/** New in v4. Continuity is a closing dependency and a working-capital item, not an IT item. */
const PROCESSING_CONTINUITY_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "transferable",
      label: "Existing merchant agreement transfers",
      kind: "enum",
      options: [...TRANSFERABILITY],
      help: "Standard-form agreements bar merchant assignment without written consent while letting the bank assign freely. Expect 'does-not-transfer'.",
    },
    {
      key: "ownershipChangeClause",
      label: "Ownership-change clause",
      kind: "enum",
      options: ["event-of-default", "advance-notice-required", "silent", "unclear"],
      help: "A change of more than 25% of legal or beneficial ownership is commonly an event of default with an advance-notice obligation.",
    },
    {
      key: "buyerAccountStatus",
      label: "Buyer's own account",
      kind: "enum",
      options: ["approved", "in-underwriting", "application-not-started", "unclear"],
    },
    {
      key: "expectedGapDays",
      label: "Expected days without processing",
      kind: "text",
      help: "From the acquirer's own quoted timeline, dated. No published standard for re-underwriting duration exists — do not estimate one.",
    },
    { key: "newAccountReserve", label: "Up-front reserve or deposit hold quoted", kind: "money" },
    {
      key: "preCloseDisputeLiability",
      label: "Pre-close chargeback liability allocated to",
      kind: "enum",
      options: ["seller", "buyer", "unallocated", "unclear"],
      help: "Disputes on pre-close transactions land on the seller's MID and the seller's reserve, whatever the purchase agreement assumes.",
    },
    { key: "observation", label: "What the agreement and the acquirer actually say", kind: "longtext" },
  ],
};

/**
 * v3's fields recorded format, scope and record types. The research adds three things a rating
 * actually turns on and one that is a valuation input in its own right:
 *  - contactable count vs row count (Square masks contact details on customers acquired through
 *    other sellers, so a customer count overstates the marketable list — vendor-documented),
 *  - the earliest record date, which is how a 60- or 90-day API default window gets caught being
 *    passed off as full history,
 *  - how long the data stays reachable after close or cancellation, which decides whether this is a
 *    pre-close obligation or a post-close task,
 *  - whether the account itself transfers, which is a separate failure mode from exportability.
 */
const DATA_EXPORT_V4_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "systemChecked", label: "System exported from", kind: "text" },
    { key: "performedOn", label: "Performed on", kind: "date" },
    {
      key: "exportFormat",
      label: "Format received",
      kind: "enum",
      options: ["csv-json-xml", "spreadsheet", "api", "pdf-only", "screenshot-only", "none", "unclear"],
      help: "CSV/JSON/XML passes the machine-readability benchmark. A spreadsheet passes but check it against the 1,048,576-row ceiling — a file at the ceiling is presumptively truncated. PDF, print-only and screenshots fail.",
    },
    {
      key: "exportScope",
      label: "History covered",
      kind: "enum",
      options: ["full-history", "limited-window", "current-state-only", "unclear"],
    },
    {
      key: "earliestRecordDate",
      label: "Earliest record in the export",
      kind: "date",
      help: "Sort ascending and compare to the business's age. Exactly 12/24/48/60 months back is a retention horizon or an export cap; ~60 or ~90 days back is an API default window being passed off as history.",
    },
    {
      key: "recordsCovered",
      label: "Record types included",
      kind: "text",
      placeholder: "e.g. customers, transactions, appointments",
    },
    {
      key: "customerRowCount",
      label: "Customer rows in the export",
      kind: "text",
      help: "Compare against the count the platform displays in-app. Round numbers — 500, 1,000, 5,000, 10,000, 50,000 — are export limits, not coincidences.",
    },
    {
      key: "contactableCount",
      label: "Contactable customers",
      kind: "text",
      help: "Rows with a usable, unmasked email or phone AND a consent the buyer can rely on. The number that matters is not the row count. State both — a large gap is a valuation adjustment, not a technical footnote.",
    },
    {
      key: "postCloseAccessWindow",
      label: "Data access after close / cancellation",
      kind: "text",
      placeholder: "e.g. 60 days from account closure",
      help: "Vendor-documented where possible. Where the window is short or undocumented, extraction becomes a dated pre-close seller obligation, not a post-close task.",
    },
    {
      key: "accountTransferPath",
      label: "Account transfer path",
      kind: "enum",
      options: ["self-service", "support-mediated", "not-supported", "undocumented", "unclear"],
      help: "Separate failure mode from exportability. Some platforms document that they do not transfer accounts on a business sale at all; others document nothing, which is not the same as 'yes'.",
    },
    { key: "observation", label: "What was observed", kind: "longtext" },
  ],
};

/**
 * v3's `conflictsFound` enum offered "similar-different-class" and "similar-same-class", which
 * encodes the rating rule TMEP §1207.01(d)(v) contradicts outright: classification "has no bearing
 * on the question of likelihood of confusion" — the identification wording controls. A stored value
 * of "similar-different-class" reads as "probably fine", which is the wrong inference. The class is
 * still recorded, as a fact, in its own field.
 */
const TRADEMARK_V4_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "markSearched", label: "Mark searched", kind: "text" },
    {
      key: "registersSearched",
      label: "Registers and surfaces searched",
      kind: "text",
      placeholder: "e.g. USPTO Trademark Search, TSDR, Assignment Center, CA state register, web",
    },
    {
      key: "jurisdictionsNotSearched",
      label: "Jurisdictions and surfaces NOT searched",
      kind: "text",
      placeholder: "e.g. NV and AZ state registers; design marks; international",
      help: "An unstated scope is what makes this finding indefensible, and an operating state left unsearched is itself a rating input.",
    },
    {
      key: "federalStatus",
      label: "Federal registration held by the seller",
      kind: "enum",
      options: ["registered", "pending", "none-found", "unclear"],
    },
    {
      key: "classesRecorded",
      label: "Nice class(es) observed",
      kind: "text",
      help: "Recorded as a fact only. Class has no bearing on likelihood of confusion — the identification wording controls. Current edition is NCL 13-2026, in force 1 January 2026.",
    },
    {
      key: "conflictsFound",
      label: "Conflict facts observed",
      kind: "enum",
      options: [
        "none-found",
        "similar-non-overlapping-goods",
        "similar-overlapping-goods",
        "identical-overlapping-goods",
        "unclear",
      ],
      help: "Judged on whether the identifications overlap in wording, not on whether the class numbers match. Same class is not a conflict; different class is not safety.",
    },
    {
      key: "chainOfTitleClean",
      label: "Chain of title and encumbrances",
      kind: "enum",
      options: ["recorded-to-selling-entity", "recorded-elsewhere", "security-interest-recorded", "not-applicable", "unclear"],
      help: "Assignment Center shows only the last recorded owner. A mark still recorded to a founder or predecessor, or a security interest with no release, is where a small deal loses its brand.",
    },
    { key: "observation", label: "What was found, as facts", kind: "longtext" },
  ],
};

/** New in v4 — the artifact without which DKIM and key length cannot be graded at all. */
const TEST_MESSAGE_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "messageObtained",
      label: "Message obtained",
      kind: "enum",
      options: ["yes-transactional", "yes-marketing", "no", "unclear"],
      help: "A genuine message from the business's primary sending system — an order confirmation, booking reminder or invoice. A message you sent yourself through a different system proves nothing about this one.",
    },
    { key: "sendingSystem", label: "Sending system", kind: "text", placeholder: "e.g. Toast, Mailchimp, Google Workspace" },
    { key: "receivedOn", label: "Received on", kind: "date" },
    {
      key: "dkimSelector",
      label: "DKIM selector and signing domain (s= / d=)",
      kind: "text",
      help: "Read from the DKIM-Signature header of the raw message. DKIM has no discovery mechanism — this is the only way to know the selector.",
    },
    {
      key: "dkimKeyBits",
      label: "DKIM key length (bits)",
      kind: "text",
      help: "Decode the p= value from the selector's DNS record. RFC 8301 §3.2: signers MUST use at least 1024 bits and SHOULD use at least 2048; NIST SP 800-177r1 Table 4-3 says 2048 with a one-to-two-year lifetime.",
    },
    {
      key: "authResults",
      label: "Authentication-Results verdicts",
      kind: "text",
      placeholder: "e.g. spf=pass dkim=pass dmarc=pass",
      help: "The receiver's own verdict on a real message. This is the highest-value artifact in the whole email check — it beats any amount of DNS inspection.",
    },
    {
      key: "fromAlignment",
      label: "d= aligned to the visible From domain",
      kind: "enum",
      options: [...YES_NO_UNCLEAR],
    },
    { key: "observation", label: "What the headers showed", kind: "longtext" },
  ],
};

// ---------------------------------------------------------------------------
// Per-item revisions, keyed by the v3 title they apply to
// ---------------------------------------------------------------------------

type Revision = Partial<
  Pick<
    TemplateItemInput,
    | "description"
    | "guidance"
    | "severityGuidance"
    | "fieldSchema"
    | "evidenceExpectation"
    | "blockingDependency"
  >
>;

const REVISIONS: Record<string, Revision> = {
  // --- Tier A, automated ---
  "Domain and registrar ownership, expiration": {
    description:
      "Registrar of record, registrant organisation, registration and last-transfer dates, expiry date, and the registry status codes set on the domain.",
    guidance:
      "Automated, then corroborated by hand. Since ICANN sunset WHOIS on 28 January 2025, RDAP is the definitive source for gTLD registration data (WHOIS is still required only for .com, .name and .post — not .net — and many registries still answer it voluntarily, so a WHOIS answer is not evidence that the data is authoritative). Capture creation date and last-transfer date as well as expiry, plus the full EPP status set: all three of ICANN's 60-day lock windows are invisible without them. Registrant name and email are routinely redacted under the Registration Data Policy in force since 21 August 2025, so a lookup cannot establish control — corroborate from the registrar account on a screen-share, and have the seller demonstrate that they can retrieve the AuthInfo code and toggle clientTransferProhibited. That demonstrates operational control rather than credential possession, and ICANN's Transfer Policy §5.2 obliges the registrar to supply the code and remove the lock within five calendar days of a request, so an inability to do it is a finding about the seller, not about the registrar. Sequencing matters and ICANN gives the advice itself (Transfer Policy §II.C.1.3): transfer to the buyer's registrar FIRST, then change the registrant. Doing it in the intuitive order triggers the 60-day lock and strands the domain at the seller's registrar. Handing over registrar account credentials is not a transfer — the seller remains the Registered Name Holder in the registry record. For the cost of a missed renewal, retrieve the sponsoring registrar's own published redemption/restore fee (ICANN's Expired Registration Recovery Policy §4.1 requires every registrar to publish it) and record the figure with its retrieval date; there is no ICANN cap on restore fees, and the dollar figures that circulate for particular registrars are unsourced.",
    severityGuidance:
      "THRESHOLD BASIS — state this in the report. No published standard exists, in ICANN policy, NIST, the CIS Controls or any M&A diligence framework, for how far before expiry a domain becomes a risk flag. This firm's stated basis is expiry falling within the expected close date plus 90 days, derived from ICANN SSAC SAC 010 Recommendation 3's 90/60/30 renewal-notice cadence, the Transfer Policy's three 60-day lock windows plus execution time, and §II.B.2.1's absolute bar on transferring an expired registration. Present it as this firm's methodology choice, never as an industry standard.\n\nRED: the domain is expired, or RDAP shows autoRenewPeriod, redemptionPeriod, pendingRestore or pendingDelete — an expired registration cannot be transferred to the buyer at all until renewed, and redemptionPeriod prohibits transfers outright. The registrant of record is not the selling entity (an owner personally, a former employee, a developer, agency or reseller): a sale is a Change of Registrant requiring the Prior Registrant's confirmation, so a wrong registrant who later becomes unreachable can block a compliant transfer permanently. A Change of Registrant, a creation, or a prior inter-registrar transfer occurred within the last 60 days and close falls inside that window. serverTransferProhibited, serverUpdateProhibited, serverRenewProhibited, serverHold, or clientHold with no documented unlock path — registry locks are cleared by the registry, not the registrar, on an out-of-band phone-and-passphrase procedure. The domain is subject to a UDRP or URS proceeding, a TDRP dispute or a court order, all of which the registrar MUST deny a transfer on. The seller proposes handing over registrar credentials instead of a compliant transfer. The registrant contact email is a personal address the seller keeps after close — every transfer confirmation routes through it. Nobody can produce the AuthInfo code or demonstrate unlocking within the five-calendar-day obligation.\n\nYELLOW: expiry falls within expected close plus 90 days (cheap remedy: multi-year renewal as a closing condition). Auto-renew is on but billed to an individual's personal card. clientTransferProhibited is set, correctly, but the unlock path has not been demonstrated. The registrant organisation is right but the contact is an individual rather than a role address on a domain the buyer will own. The domain sits at a reseller rather than a direct registrar account — note that a reseller may not deny a transfer over its own payment dispute with the registrar where the registrant has paid (§I.A.3.9). RDAP output is redacted and registrar-account access has not yet been shown. The domain is a ccTLD with a non-standard lifecycle — the 45-day auto-renew grace, 30-day redemption and 5-day pending-delete periods are fixed for gTLDs only. The business's nameservers or email depend on a second domain that is not part of the transaction: if that one lapses, a new registrant can redirect DNS and intercept mail (ICANN SSAC SAC 044). 'ok' is the only status on a business-critical domain — RFC 5731 requires that ok 'MUST NOT be combined with any other status', so its presence is positive proof that no transfer, update or delete protection is set.\n\nGREEN: registrant of record is the selling entity and matches the purchase agreement; expiry is more than 90 days beyond expected close or multi-year renewal is a closing condition; auto-renew runs against a company payment method with reminders to a role address the buyer will control; clientTransferProhibited, clientUpdateProhibited and clientDeleteProhibited are all set with a demonstrated ability to remove them; no server-side locks, or a registry lock with a pre-arranged unlock procedure; no Change of Registrant, creation or transfer in the last 60 days, verified from RDAP's own dates; the AuthInfo code was retrieved during diligence; and transfer sequencing is agreed in writing.\n\nRE-VERIFY AT THE AUDIT DATE. This is the fastest-moving fact in the checklist. The ICANN Board adopted the revised Transfer Policy — all 47 Transfer Policy Review recommendations — by Resolution 2026.06.07.04 on 7 June 2026. That revision removes the 60-day Change-of-Registrant lock entirely, replaces the creation and transfer locks with 720-hour (30-day) locks, and moves registrant-data changes to a separate CORD Policy. It is not in force: no implementation review team text has been published, no effective date announced, and registrars requested an 18-month buffer after implementation concludes. The 60-day lock applies today, confirmed in live registrar documentation. Blog posts asserting that 30-day locks already apply in 2026 are describing the adopted-but-unimplemented policy as if it were operative. Likewise, the binding policy term is 'AuthInfo code'; 'Transfer Authorization Code (TAC)' comes from the same unimplemented revision.",
  },
  "DNS provider and hosting fingerprint": {
    guidance:
      "Automated. The question behind it is who the buyer will have to get an account from on day one. Nameservers pointing at an agency's account, or at a provider the seller cannot name, is the finding — not the technology itself. Read this item together with the email-authentication one: every remediation there is a TXT record at the apex, at _dmarc, and at the DKIM selector, so a domain whose DNS the buyer cannot administer on day one has an unfixable email posture regardless of what the records currently say. Check specifically whether the authoritative nameservers live on a *different* domain from the one being sold: ICANN's SSAC (SAC 044) documents the second-order failure where a lapsed domain hosting another's nameservers lets a new registrant redirect DNS and intercept mail.",
    severityGuidance:
      "Severity follows transfer risk, not technology choice. Red if DNS is controlled by a party outside the transaction with no established transfer path, or if the business cannot demonstrate that it can publish a TXT record on request — that inability caps the email-authentication item at Red too, because nothing there is remediable until it is fixed. Yellow if the provider is unidentifiable from public records, if DNS and hosting sit with different uncontactable parties, or if the nameservers depend on a domain outside the transaction. Green if both resolve to accounts the seller can demonstrate control of and that are on the asset schedule.",
  },
  "SSL/TLS certificate validity, issuer, expiration": {
    guidance:
      "Automated. A lapsed certificate is rarely important in itself — it is a maintenance signal, and what matters for the buyer is whether anyone is currently responsible for renewing it. Certificate lifetimes are shortening on a ratified schedule: the CA/Browser Forum Baseline Requirements v2.3.0 §1.2.2 cap validity at 200 days for certificates issued on or after 15 March 2026, falling to 100 days on 15 March 2027 and 47 days on 15 March 2029 (Ballot SC-081v3, passed 11 April 2025). A business surviving on manual annual renewals today will need to renew four to eight times a year inside the buyer's first ownership cycle, which is the finding worth writing. Note that a certificate issued before 15 March 2026 can legitimately carry a 398-day life, so a long-dated certificate seen today is not evidence of misissuance — do not flag it. Ask what monitors expiry, and ask specifically whether the business relied on Let's Encrypt's expiry-notification emails: that service ended on 4 June 2025, so a target still 'relying on the emails' has had no safety net for over a year.",
    severityGuidance:
      "THRESHOLD SHAPE — this is where most circulating guidance is wrong. No standards body publishes a days-to-expiry risk threshold, and a fixed day count is now the wrong shape entirely. The renewal norm published by the CA ecosystem is proportional: Let's Encrypt recommends renewing when one third of the lifetime remains, and Certbot made that its default in v4.0.0 (April 2025), having previously used a fixed 30 days; RFC 9773's renewal-information extension exists precisely to remove hard-coded expiry thresholds. Let's Encrypt also issues six-day certificates, on which two days remaining is healthy and normal. Rate on the proportion of lifetime remaining, not on a day count. The 30/14/7 convention is vendor folklore: published vendor defaults range from 90/60/30/7/3 (DigiCert) to day-of-expiry (Pingdom), and the only non-vendor published tier is NIST SP 1800-16B §5.1.15's 90/60/30 with escalation at 30, which NIST itself brackets as a suggestion and which conflicts with the one-third rule for any certificate shorter than 90 days. If you apply either, name the conflict rather than picking one silently.\n\nRED: certificate expired; hostname does not match — note that a wildcard covers neither the apex nor multi-level subdomains (RFC 9525 §6.3, which obsoletes RFC 6125); self-signed, broken or untrusted chain, or an expired intermediate (worth its own check, because the server certificate still looks valid and these outages take hours to diagnose); the certificate expires before the expected close date or within 30 days after it with no automated renewal; the site does not redirect HTTP to HTTPS, or serves a login, checkout or customer-data form over plain HTTP; the server offers only TLS 1.0 and/or 1.1 (RFC 8996 states both MUST NOT be used; RFC 9325 §3.1.1 requires TLS 1.2 support); where cardholder data is handled, SSL or early TLS is in use for any transmission of account data — the PCI Security Standards Council has required migration since 30 June 2018 and states it 'does not consider SSL or early TLS to be strong cryptography' (FAQ #1491, updated July 2026); or renewal is manual, undocumented, and known only to the seller or a departing employee, with no shared CA-account access and no alternate contact.\n\nYELLOW: valid but less than one third of its lifetime remains with no evidence of automated renewal — approximately 67 days on a 200-day certificate, 30 on a 90-day Let's Encrypt certificate, two on a six-day one. Manually purchased rather than issued through ACME or a platform-managed service, even where a procedure exists: this is the item most likely to break in the buyer's first year, because the renewal invoice goes to the seller's payment method. No expiry monitoring of any kind, or monitoring that rested on Let's Encrypt's discontinued expiry emails. No HSTS header — and note separately if the domain is already on the preload list, since that is a constraint the buyer inherits and OWASP warns preloading can have permanent consequences. Mixed content on customer-facing pages: blockable resources (scripts, stylesheets, iframes, fetch/XHR, web fonts) are blocked outright, so the buyer inherits broken functionality. TLS 1.0/1.1 still offered alongside 1.2/1.3 by choice. Coverage misses customer-facing hostnames in use. Certificate or DNS managed by an agency outside the transaction.\n\nGREEN: issued and renewed automatically through ACME or a platform-managed service, driven by renewal information (RFC 9773) or a proportional rule rather than a hardcoded date; covers apex, www and every customer-facing hostname with a complete chain; TLS 1.2 minimum with 1.3 offered and preferred; HTTP-to-HTTPS redirect on the same host plus HSTS with max-age of at least 31536000; no mixed content; and renewal depends on neither a single named individual nor a payment method or CA account that leaves with the seller.\n\nA note on the continuity argument: NIST SP 1800-16B documents the personnel cause directly — 'The system administrator is reassigned, and nobody else receives expiry notifications' (§3.1) — and recommends certificate ownership sit with functional groups. The step from there to 'an acquisition is a planned, simultaneous instance of exactly that discontinuity' is this firm's reasoning, not a published norm, and the payment-method half of it has no published support at all. Say so if you rely on it.",
  },
  "Email authentication posture (SPF / DMARC; DKIM best-effort)": {
    guidance:
      "Automated, and deliberately scored only on what public DNS can answer deterministically. Reproduce every finding with dig before it enters a billable report — free checkers disagree with each other on lookup counting, multiple-record handling and pct= interpretation. Count include, a, mx, ptr, exists and redirect terms recursively against RFC 7208 §4.6.4's limit of ten: exceeding it returns permerror, which means a domain that visibly 'has an SPF record' cannot actually be authenticated, and it is the most common real defect on small-business domains after six to ten accumulated SaaS includes. Run this against every domain the business owns, not just the primary one: parked, defensive and legacy domains are the unprotected spoofing surface, and NIST SP 800-177r1 Recommendation 4-1 says to publish 'v=spf1 -all' on domains that do not send. DKIM cannot be enumerated from public DNS — a failed guess at a selector proves nothing, so probe results are recorded as inconclusive and the grading of DKIM belongs to the companion test-message item. Ask separately which third parties hold DKIM keys for the domain: NIST Recommendation 4-10 says to use a unique key pair per third party and to delete or blank the key at the end of a contract, because otherwise a departing owner's agency or former ESP can keep sending authenticated mail as the acquired company after close.",
    severityGuidance:
      "SOURCES TO QUOTE. DMARC is RFC 9989 (May 2026), Standards Track, which obsoletes RFC 7489 — a rubric describing DMARC as 'only an informational RFC' is out of date. RFC 9989 removed pct= (and rf and ri), replacing it with a binary t= test mode, but pct= remains widespread in live DNS and is still honoured by many receivers, so seeing it is not itself a defect; score on effective enforcement, since 'p=reject; pct=10' behaves like p=none for 90% of traffic. For the mailbox-provider mandates: Google and Microsoft each publish a 5,000-messages-per-day bulk/high-volume threshold; Yahoo publishes no numeric threshold at all, so do not attribute one to it. Google's rules apply from 1 February 2024 with enforcement ramped from November 2025 (rejections, not filtering); Yahoo's from February 2024; Microsoft's junk-routing from 5 May 2025 with rejections reported from late 2025 — verify Microsoft's rejection date from its own announcement before printing it, and note that Google treats bulk-sender status as permanent once met even once.\n\nRED: no DMARC record on a domain used to send business email; no SPF record; SPF ending in +all or ?all; SPF returning permerror for exceeding the ten-lookup limit; multiple conflicting v=spf1 records at the apex; or the domain has ever sent 5,000 or more messages in a day to consumer mailboxes and lacks SPF, DKIM and a passing, aligned DMARC record — that is a live, dated compliance failure against published provider requirements, and mail is being rejected rather than filtered. Independently: DNS control does not transfer, or the registrar or DNS account recovers to an individual leaving at close, which caps this item at Red regardless of the record findings because nothing here is remediable until that is fixed.\n\nYELLOW: DMARC exists but is not enforcing — p=none, an enforcing policy neutered by pct below 100 or t=y, or no rua address (a policy with no reporting cannot be safely advanced or verified). SPF present and terminal but fragile: a lookup count of eight to ten is one SaaS vendor away from permerror. Owned parked or legacy domains left unprotected while the primary is clean. A former vendor's DKIM selector still live in DNS, or keys shared across third parties. DNS controlled by an agency or contractor whose cooperation at close is unconfirmed but obtainable.\n\nGREEN: exactly one v=spf1 record at the apex, terminating in -all or ~all, evaluating within the ten-lookup limit with no +all or ?all anywhere in the include chain; a valid _dmarc record at p=quarantine or p=reject with a monitored rua; non-sending and parked domains publishing v=spf1 -all; and DNS control demonstrably transferring with the deal.\n\nWHY p=none IS NOT GREEN, with a citable basis: CISA Binding Operational Directive 18-01 treats p=none with reporting as an acceptable interim state on a 90-day clock and p=reject as the required end state within one year. NIST SP 800-177r1 §4.6.3 frames p=none as an early-stage setting that leaves disposition 'wholly on the receiver's local policy', and the UK NCSC states plainly that a policy of none 'won't affect the delivery of your email'. p=none is telemetry, not a control.\n\nDKIM NEVER LOWERS THIS RATING ON ITS OWN. A not-found result at a guessed selector is not evidence of absence, and scoring a domain Red for 'no DKIM' on probed selectors is an indefensible finding. Key length and signature validity are graded on the companion test-message item, against RFC 8301 §3.2 (at least 1024 bits MUST, at least 2048 SHOULD, rsa-sha1 MUST NOT) and NIST SP 800-177r1 Table 4-3 (2048 bits, one-to-two-year lifetime). Cite M3AAWG only for the six-month rotation cadence: the SPF/DKIM/DMARC checklist widely attributed to its Sender Best Common Practices does not appear in v4.0 (August 2026).",
  },
  "Mail provider fingerprint": {
    guidance:
      "Automated. A transfer-complexity signal. Registrar-bundled or self-hosted mail is materially harder to hand over than a managed provider, and mail hosted inside a departing employee's personal account is a finding in its own right. Two things to carry into the email-authentication item: whether the mail provider is also the DKIM signer (and therefore whether its account transfers), and whether any third party — an ESP, a marketing agency, a former web developer — still holds a live DKIM key for the domain. NIST SP 800-177r1 Recommendation 4-10 requires a unique key per third party and deletion or blanking of the key at contract end, precisely so that a former vendor cannot keep sending authenticated mail as the business. Check too whether the MX records point at a hostname on a *different* domain that is not part of the transaction: if that domain lapses, a new registrant can receive the business's mail (ICANN SSAC SAC 044).",
    severityGuidance:
      "Yellow if mail is self-hosted, registrar-bundled, or absent entirely while the business advertises an email address on that domain; if mail delivery depends on a hostname in a domain outside the transaction; or if a third party's DKIM selector for this domain is still live with no inventory of who holds keys. Green for a managed provider the seller can demonstrate administrative control of, on an account that is on the asset schedule. Red only where the records show mail is delivered somewhere outside the seller's control.",
  },
  "HTTPS hygiene": {
    guidance:
      "Automated. Low individual weight. Its value is corroborative — combined with an unmaintained platform fingerprint and a lapsed certificate it evidences an absence of anyone maintaining the site, which is the finding a buyer can act on. Two details worth recording precisely rather than generically. First, HSTS: the preload list requires max-age of at least 31536000 with includeSubDomains and preload, plus an HTTP-to-HTTPS redirect on the same host, while Mozilla's deployment floor is six months — these are not in conflict, they answer different questions, so do not flag a six-month max-age on a site that is not seeking preload. Do record separately whether the domain is already preloaded, because OWASP warns that preloading can have permanent consequences and it is a constraint that survives the transaction. Second, mixed content: blockable resources — scripts, stylesheets, iframes, fetch and XHR, web fonts — are blocked outright in browsers and have been since January 2020, while images, audio and video are auto-upgraded. Blocked resources mean functionality the buyer inherits broken, which is a different finding from a cosmetic warning.",
    severityGuidance:
      "Yellow if HTTP does not redirect to HTTPS, particularly where the site takes payment or bookings; if blockable mixed content is present on customer-facing pages; or if TLS 1.0/1.1 remain enabled alongside 1.2/1.3 by choice (RFC 8996 states both MUST NOT be used; the TLS 1.2 floor is RFC 9325 §3.1.1). Green if the redirect is enforced on the same host, HSTS is present with max-age of at least 31536000, and no blockable mixed content is served. A missing strict-transport-security header is worth noting but is not on its own a Yellow. Red is reserved for plain HTTP on a page that takes credentials, payment or customer data, or a server offering only TLS 1.0/1.1.",
  },
  "Google Business Profile ownership and claim status": {
    guidance:
      "Manual — there is no public interface that reports claim status, so this is done by inspection. Search the business, open the listing, and look for the owner-response and 'own this business?' signals. Where the seller can screen-share the listing dashboard, prefer that and record it here. For a local business the listing is frequently a larger revenue driver than the website, and it is the asset most often left behind at close. Record the review count and state what happens to it: Google documents that reviews follow the profile through an ownership transfer, so the rating is an asset the buyer can actually acquire — which is not true of every platform's reviews. Yelp, by contrast, documents that it may split the page where new owners make a significant name change and does not state what happens to the reviews in that case; treat that as a question to put to the seller and to Yelp, not as a fact to assert either way.",
    severityGuidance:
      "Red if the listing is administered by a third party outside the transaction (a former agency or departed manager) with no agreed transfer path, or if a duplicate or competing listing is capturing traffic. Yellow if claim status cannot be determined, if the listing is unclaimed and therefore open to being claimed by someone else, or if the business's rating is material to demand and sits on a platform whose reviews are not documented to survive a name change or ownership transfer. Green if the seller demonstrates administrative control and the listing is accurate.",
  },
  "Trademark conflict scan on business name / domain": {
    guidance:
      "Manual and consultant-triggered, and a factual screening of public registers — not a comprehensive clearance search and not a legal opinion. Budget 60–90 minutes per primary mark, record the date of every search, and save a PDF of every result screen so each finding is reproducible from the workpaper. Search the federal register at the USPTO's Trademark Search system (TESS was retired on 30 November 2023 and is no longer the tool — citing it dates the report). For each mark run exact wording, phonetic equivalents and common misspellings, the dominant word alone where the mark is a phrase, and singular/plural and hyphenation variants; run each search twice, live-only and then including dead and abandoned records. Dead is not safe: the USPTO states that while dead records cannot bar a registration they 'can present other legal problems if they're still being used in commerce', and a common-law owner can act against you even where you hold a federal registration. Translate the business into goods-and-services language using the USPTO's Trademark ID Manual and record both the accepted identification wording and the class; the current edition is the 13th, NCL 13-2026, in force since 1 January 2026, and classes move between editions (corrective glasses and sunglasses moved from Class 9 to Class 10) while existing registrations are not reclassified — so a pre-2026 registration's class may not match a 2026 filing for the same goods. Verify every material hit in TSDR for current status and §8/§9 maintenance filings, then pull chain of title in Assignment Center, which is where an undisclosed security interest against the mark, or a mark still recorded to a founder or predecessor entity, actually surfaces — note that its search shows only the last recorded owner, not the chain. Search the register of every state the business operates, sells or has locations in: state registration confers rights in that state only, there is no official consolidated multi-state trademark search, and the consumer tools advertising 'all 50 states' search business-entity registries rather than trademark registers. Record both the jurisdictions searched and those not searched. Cover common-law surfaces per the USPTO's own list — state business and DBA registries, domain registrations, and search-engine sweeps in the same trade; app stores and social handles are supplementary observation and are not on that list. Screen internationally (WIPO Global Brand Database, Madrid Monitor, TMview, all free) only where the target sells or sources abroad, and say so explicitly where you scoped it out. Design and logo marks need specialist searching — flag any material logo as outside this scan's reach.\n\nTHE FRAMING THAT PROTECTS YOU: you are not inventing a methodology, you are executing the one the USPTO publishes. Its comprehensive-clearance guidance states that such a search covers the federal database, state trademark databases and the internet, and that while an examining attorney searches the federal database, 'it's your responsibility to search state trademark databases and the internet'. Cite that page in the workpaper.\n\nTHE NON-ATTORNEY LINE: 37 C.F.R. §11.14(b) provides that non-attorneys are not recognised to practise before the USPTO in trademark matters, and §11.5(b)(2) defines practice to include consulting with or advising a client in contemplation of filing a trademark application. That rule governs representation before the Office, which a diligence consultant is not doing — but adopt it voluntarily as the bright line. Report facts and never conclusions: 'a live federal registration, Reg. No. X, for mark Y in Class Z, owned by [entity], covering [verbatim identification], appears in USPTO Trademark Search as of [date]' is a fact; 'this registration does not conflict' is a legal opinion. Avoid the words infringe, clear, safe to use, no conflict, and likelihood of confusion as a conclusion; use observed, appears on the register as, overlaps on its face with, and warrants review by trademark counsel. Every Red or Yellow gets one sentence naming what counsel should opine on and by when relative to close. Be honest internally that no citable authority exists on a non-lawyer consultant reporting trademark search results — the protection is factual reporting, the scope disclaimer, engagement-letter scope and E&O review, which is a judgment call rather than a sourced rule.",
    severityGuidance:
      "THE CLASS TRAP — this is the correction that changes ratings. Do not rate on whether the Nice class matches. TMEP §1207.01(d)(v) states that 'the classification of goods and services has no bearing on the question of likelihood of confusion… it is the manner in which the applicant and/or registrant have identified their goods or services that is controlling'. Same class is not a conflict and different class is not safety; rate on whether the identifications overlap in wording, and report the class as a fact only. Note also that the TMEP's own foreword says it does not have the force and effect of law, and that it describes examiner behaviour on registrability rather than a buyer's litigation exposure — keep those separate. The controlling likelihood-of-confusion case is In re E. I. du Pont de Nemours & Co., 476 F.2d 1357 (C.C.P.A. 1973), and applying its factors is counsel's job, not this engagement's.\n\nRED — refer to trademark counsel before close. Any of: a live federal registration or pending application owned by an unaffiliated party for a mark identical or near-identical on its face (differing only by spelling, spacing, hyphenation, pluralisation or obvious phonetic equivalence) whose identification of goods or services overlaps in wording with the target's; the target's primary trading name having no federal registration of its own while such a third-party registration exists; a mark the seller represents as an acquired asset that is not recorded to the seller's current legal entity in Assignment Center with no assignment document produced; a recorded security interest against a scheduled mark with no payoff or release; a registration the seller relies on showing DEAD, ABANDONED, CANCELLED or EXPIRED status or a missed §8/§9 deadline in TSDR; a live third-party registration subject to a pending opposition, cancellation or concurrent-use proceeding involving the target; or documented third-party correspondence — a cease-and-desist, opposition or demand letter — concerning any scheduled mark.\n\nYELLOW — qualified; obtain counsel's view or a seller representation. Any of: a live third-party registration for a similar but not identical mark in adjacent but non-overlapping goods; a live third-party registration for an identical mark in a different, non-overlapping identification (class recorded as a fact only); a dead or abandoned record for an identical mark in overlapping goods together with evidence the mark is still in use; a state registration held by an unaffiliated party in an operating state; one or more unregistered third parties operating under an identical or near-identical name in the target's category; the target's mark unregistered at every level while material to revenue or goodwill; a materially valuable logo where design-mark searching was out of scope; international sales with no international register searched; or any operating state that could not be searched.\n\nGREEN — no conflict facts observed within the stated scope on the stated date. Every listed mark searched live and dead on recorded dates; no live third-party registration for an identical or near-identical mark in overlapping or adjacent goods; every registration the target holds live, with current maintenance filings, owned by the current legal entity and free of unreleased security interests; state registers searched in every operating state with no unaffiliated hits; common-law surfaces searched with no unaffiliated operator in the category; no dead-but-apparently-in-use conflicting mark; and no scope limitation material to brand value.\n\nGreen means no conflict facts were observed within the stated scope on the stated date. It does not mean the mark is clear to use, and the report must say so. Common-law rights arise from use rather than registration and can defeat a federal registrant within the prior user's geography (15 U.S.C. §1115(b)(5)), so the absence of a federal registration is not evidence that no conflicting rights exist.",
    fieldSchema: TRADEMARK_V4_FIELDS,
  },

  // --- Tier B ---
  "Payment processor account standing": {
    description:
      "The standing of the business's card-processing account: chargeback and fraud experience measured the way each card network measures it, any reserve or hold, and whether the acquirer has put anything in writing.",
    guidance:
      "Ask for 13 months of processor statements by merchant ID — not a summary and not a single clean month, and 13 rather than 12 because Mastercard's ratio uses the preceding month's sales as its denominator, so rating the first month needs the month before it. Obtain alongside them the complete processing agreement with all addenda and copies of every written notice from the acquirer or the card networks in the trailing 24 months, including any monitoring-programme, reserve, repricing or intent-to-terminate letter. Compute the Visa ratio as Visa publishes it — (TC40 fraud reports + TC15 disputes) ÷ settled card-not-present transactions — and remember it is card-not-present only, so a restaurant or salon sits substantially outside it, and that the numerator combines issuer fraud reports with disputes, meaning a merchant with near-zero chargebacks can still be flagged on TC40s it never sees on a statement. Compute the Mastercard ratio the way Mastercard does, dividing a calendar month's chargebacks by the preceding month's sales transactions, and then recompute it same-month and show the client both: a seasonal or declining business gets a mechanically inflated lagged ratio, which is an artifact to disclose rather than a deterioration to score. Be explicit in the finding that a merchant account does not transfer — that is the separate continuity item — so this item is about the risk profile and the revenue continuity the buyer inherits, not about assigning a contract.",
    severityGuidance:
      "VISA — the programme changed and the old numbers are wrong. Visa retired VDMP and VFMP on 1 April 2025 and replaced them with the Visa Acquirer Monitoring Program (VAMP), advisory until enforcement began on 1 October 2025; the 0.9%-and-100-disputes figures that still circulate are the retired programme's. Under Visa's published VAMP fact sheet the merchant Excessive threshold is 150 bps in the US, Canada, Europe and AP effective 1 April 2026 (reduced from 220 bps; CEMEA remains 220 bps), and it applies only above a floor of 1,500 combined TC40 and TC15 events in a month. There is no merchant 'Above Standard' tier — that exists only for acquirers, at 50 bps and 70 bps. DEAL-BAND REALITY: 1,500 events a month at 1.5% implies roughly 100,000 card-not-present transactions a month, so no business in the $200k–2M band is identified at merchant level. VAMP exposure here is indirect — the target degrading its acquirer's portfolio ratio — and that is what actually triggers repricing, reserves and offboarding. Rate the acquirer relationship, not the ratio, and say so in the note. Note also that Visa's Core Rules deliberately do not publish these numbers, deferring to a non-public programme guide, so the fact sheet is the ceiling of public primary evidence.\n\nMASTERCARD — the programme that actually bites in this band. The Excessive Chargeback Merchant tier requires 100–299 chargebacks AND a chargeback-to-transaction ratio of 150–299 bps in the same month; High Excessive requires 300 or more and at least 300 bps. Both count and ratio must be met. Fines begin in the second consecutive violation month and escalate, issuer recovery applies from month four, and exit requires three consecutive months below threshold. Unlike VAMP this counts all Mastercard chargebacks with no card-present exclusion, and 100 chargebacks a month is reachable for a small e-commerce or subscription business. The Excessive Fraud Merchant programme attaches where, in one month, Mastercard e-commerce sales exceeded 1,000 in the prior month, fraud chargebacks reach USD 50,000, fraud-to-sales reaches 50 bps, and 3-D Secure usage is under 10% in non-regulated markets — 50 bps, not the 1.5% figure that circulates. SOURCING CAVEAT to disclose: Mastercard's current programme manual is not publicly retrievable, so these figures rest on acquirer and processor restatements corroborated across several current sources, with the best public guide dated 2019. State it as 'no announced change identified', not 'confirmed unchanged'.\n\nRESERVES — there is no standard, and anyone quoting one is wrong. No authoritative source publishes 'standard' reserve percentages or durations: a reserve is a contractual term at acquirer discretion, not a network rule. The OCC's Comptroller's Handbook on merchant processing documents the mechanism and the triggers — acquirers establish reserves against merchants posing high risk or with a history of chargebacks, or where delivery is deferred — and contains no percentages. Standard-form merchant agreements permit a reserve 'at any time, in its sole discretion', in an amount the bank determines, with the merchant having no right to withdraw the funds and post-termination holds running for such time as the bank determines. So the absence of a reserve today is not evidence that one cannot be imposed tomorrow, and a reserve in place is an explicit statement that the acquirer has priced this merchant as elevated risk. Where one exists, document the percentage withheld, the hold period, whether it is rolling, capped or up-front, the current accrued balance, and whether that balance is a purchased asset or stays with the seller's entity. The 5–10%-for-90-to-180-days figures are vendor convention; if you cite them, label them as convention rather than rule, and note that the '0.9–1.0% triggers a reserve' figure is suspiciously close to the retired Visa threshold and may simply be an artifact of it.\n\nRED: any written monitoring-programme, reserve, repricing or intent-to-terminate notice from the acquirer or a network in the trailing 12 months; the account terminated or under review; a reserve material against working capital; or Mastercard's count and ratio both met in any month of the period. YELLOW: a computed ratio trending toward the Mastercard ECM floor; a reserve that is immaterial but unaddressed in the purchase agreement; fewer than 13 months of statements provided; or pre-dispute deflection (RDR, Order Insight, Ethoca) or Compelling Evidence 3.0 in use, since Visa excludes both from the ratio and the reported number will rise post-close with no change in behaviour — confirm in writing which are in use. GREEN: 13 months of statements, no written notices, no reserve, and counts below the Mastercard floor on both the lagged and the same-month basis. Always record the exact period reviewed; a rating drawn from one month is not defensible.\n\nRE-VERIFY AT THE AUDIT DATE and state in the note which programme version you applied. These thresholds are revised periodically — Visa's current merchant threshold took effect on 1 April 2026 — and the whole point of naming the source is that a reader can check it.",
    fieldSchema: PAYMENT_STANDING_FIELDS,
  },

  // --- Tier C ---
  "Data-export test": {
    description:
      "A performed export of the business's own operating data, verifying what the buyer can actually obtain: the format and history depth, how much of the customer list is genuinely contactable, and how long the data stays reachable after close.",
    guidance:
      "Actually run the export on a screen-share; do not accept a description of it. Before you start, record ground truth independently: reported trailing revenue, the business's age or earliest plausible trading date, the record counts the platform displays in-app (screenshot them), the seller's subscription tier and add-ons — export capability is plan-gated on several major platforms — and whether an embedded platform loan exists, because those block or gate account transfer. Then request (a) the full customer list, (b) full transaction history at line-item grain, (c) full appointment history where applicable, (d) gift-card, package and membership balances, and (e) payout history with per-transaction fees. Record who could run it (owner-only is a dependency that does not survive the owner leaving), on what device, how long it took, whether it arrived by email — which starts a link-expiry clock ranging from 72 hours to 30 days — and whether it required a support ticket, because if so it is a favour rather than a capability and may not be repeatable post-close.\n\nThen reconcile. Sum the amount column against reported revenue for the same period and explain the residual (tips, taxes, gift-card redemptions, refunds, non-POS revenue); divide revenue by row count for an implied average ticket and compare it to the real one, since a figure far above it means rows are missing. Round-number row counts — 500, 1,000, 5,000, 10,000, 50,000 — are export limits, not coincidences. Sort ascending and look at the earliest record: a date at the business's start means full history; a date exactly 12, 24, 48 or 60 months back is a retention horizon or an export cap; a date around 60 or 90 days back is an API default window being passed off as history. Where the platform caps range per pull, confirm every consecutive window was run and that the files join without gaps or double-counting. On the customer list specifically, count non-null email and phone values and masked values (asterisks, an @ with no domain, phone values under ten digits) and state the contactable count alongside the row count. Check you have the right file: on one major restaurant platform the natural-sounding order-details export is header rows only and item revenue lives in a separate item-selection file, and on one major salon platform the 'appointments summary' is a chart of counts rather than rows. Watch the date filter — at least one vendor documents that its customer report rescopes lifetime spend to the selected range, so a default range produces a truncated list with understated value. Finally, spot-check three non-adjacent months, at least one in the earliest year available, tying export to the platform's own sales summary, that to processor settlement, and that to bank deposits, and trace ten individual transactions end to end including a refund and a gift-card redemption.\n\nPLATFORM FACTS worth having to hand, all vendor-documented as of September 2026 and worth re-checking at the audit date because help articles change without notice. Square masks the contact details of customers acquired through other sellers, so a Square customer count overstates the contactable list, and Square documents that it does not support transferring an account during the sale of a business and that deactivating an account ends access to payment history entirely. Toast allows 48 months of history filtered six months at a time, states there is no single export of all data, and keeps data accessible for 60 days after the account is closed — extraction is therefore a pre-close condition, not a post-close task; its guest export link expires in 72 hours, and its ownership transfer takes 7–11 days, is US-only, and requires any Toast Capital balance to be resolved first. Clover allows five years in the dashboard but only one year per request, with report links expiring after seven days, and documents no appointment export at all. Mindbody's full client migration is cancellation-only, paid and owner-only, with 25 days to request it and 30 days to total loss, and documents that the merchant account does not transfer. Vagaro's ownership transfer is self-serve, but it has no business-wide per-appointment report. Booksy's own current help article directs client-list requests to a support email, documents no ownership-transfer process, and licenses customer reviews to the platform; a competitor's migration page claims an export button exists, so resolve that on-screen during diligence with Booksy's own documentation as the presumption. Shopify's order API returns only 60 days without elevated access, which is the silent-truncation trap, and Shopify Capital or Credit blocks store transfer.",
    severityGuidance:
      "THE ADEQUACY BENCHMARK, and its limits. There is no published M&A standard for what an adequate export looks like — that absence is itself worth stating. Use the data-portability benchmark as a yardstick: a 'structured, commonly used and machine-readable format' (GDPR Article 20(1); Cal. Civ. Code §1798.130(a)(3)(B)(iii) carries the same phrase — note it is §1798.130, not §1798.100). The Article 29 Working Party's WP242 rev.01, endorsed by the EDPB, states that documents 'encoded in a file format that limits automatic processing… should not be considered to be in a machine-readable format', which is why PDF fails, and characterises fees, lack of interoperability or API access, and 'excessive delay or complexity to retrieve the full dataset' as hindrance. Transaction history is explicitly in scope as observed data. TWO SCOPING CAVEATS the report must not get wrong: Article 20 is a right of the individual data subject, not of the business, so cite it as the standard for what an adequate export looks like and never as a right the seller can compel from their platform; and technical portability is a separate failure mode from legal transferability — a list can be extractable and still encumbered by the privacy policy in force when it was collected, or simply not scheduled as a purchased asset in the purchase agreement.\n\nGREEN: customer list, line-item transaction history and, where applicable, appointment history all produced during diligence as actual files in CSV, JSON or XML (or a spreadsheet below the row ceiling); the transaction total ties to reported revenue within about 2% for the sampled months with the residual explained; the earliest record reaches the business's start, or the shortfall is fully explained by a documented platform retention limit the buyer has accepted in writing; the contactable rate is consistent with the business's stated marketing reach and a consent field is populated; appointment history is per-appointment and includes no-shows across the full period; all three tie-outs reconcile in all three sampled months and ten of ten traced transactions clear; the account transfers on a vendor-published process, or the buyer holds a signed, dated data-delivery obligation completing before any account-closure window opens; and no embedded loan blocks the transfer.\n\nYELLOW — scope a migration workstream and price it. Export capped per pull so full history needs multiple sequential requests with expiring download links managed against the closing calendar; email-only delivery above a volume threshold, or owner-login-only, or web-only while the operator is mobile-only; appointment history obtainable only by stitching partial reports or through a paid add-on; history reaching a documented retention horizon short of the business's age; the API being the only route to full history and it is plan-gated or paid; a contactable rate materially below the row count for a documented reason — quantify the gap and treat the marketable list as the smaller number; account transfer support-mediated with no guaranteed date, or the merchant account not transferring so settlements keep flowing to the seller during the gap (price the float and make cutover a closing condition); reviews or marketplace profile not transferring where bookings are materially marketplace-sourced; loyalty, gift-card or package balances exportable only date-range-scoped rather than lifetime.\n\nRED — a deal issue, not a task. The seller cannot produce the export during diligence at all, or produces only PDF, print, screenshots or an on-screen table to copy; the transaction total does not tie to reported revenue and the discrepancy cannot be explained; the earliest record is about 60 or 90 days old, indicating an API default window passed off as history; appointment history cannot be exported at all for an appointment-driven business and no paid add-on or funded reconstruction is planned; the customer export is a support-ticket favour with no published schema, format or service level and the file has not been obtained before the LOI expires; the account cannot transfer and no data-migration path is documented, with no dated pre-close export obligation in the purchase agreement; the post-close data window will expire before the buyer can extract; an embedded platform loan blocks the transfer and is not scheduled for payoff at or before close; or the customer list is not named as a purchased asset in the purchase agreement, the privacy policy in force at collection bars transfer to a successor, or the buyer's intended use is materially inconsistent with collection-time promises with no notice or opt-in plan.\n\nRed does not necessarily kill the deal. It means the data becomes a priced, dated, contractual deliverable — a pre-close seller obligation with files in escrow — rather than something the buyer assumes will be there on day one. Two lines worth putting in the report in terms the buyer will act on: a customer count is not a contactable customer count, and state both; and extraction is a pre-close task on every platform studied.",
    fieldSchema: DATA_EXPORT_V4_FIELDS,
  },
  "Live login to the primary operating system": {
    guidance:
      "The point-of-sale, booking, or equivalent system the business actually operates on. Performed outside this product, in your own session — no credentials are accepted or stored here. Test for owner-level control rather than the existence of a working login, and note where the account of record is a personal one. Then establish the transfer mechanics from the vendor's own documentation rather than from the seller's expectation, because they differ sharply by platform and several are worse than anyone assumes: Square documents that it does not support transferring an account during the sale of a business (the buyer opens a new account, and deactivating the old one ends access to its payment history); Toast's transfer is support-mediated, 7–11 days, US-only, and requires any Toast Capital balance resolved first, while sales deposits continue flowing to the bank account on file until cutover and already-deposited funds cannot be re-routed; Mindbody's is manual and its merchant account does not transfer at all, with pre-cutover transactions continuing to deposit to the previous owner's bank account and the new owner having to apply within 30 days to accept integrated payments; Vagaro's and Shopify's are self-service, though Shopify Capital or Credit blocks the store transfer; Clover and Booksy document no transfer process at all, which is not the same as 'yes' — get it in writing before signing. Record which of these applies and the date you checked, since vendor help articles change without notice.",
    severityGuidance:
      "Red where owner-level access cannot be produced by anyone in the transaction, where the vendor documents that the account cannot transfer and no migration path is planned, or where an embedded platform loan blocks the transfer and is not scheduled for payoff at or before close. Yellow where access is limited, shared, or held in a personal account; where the transfer is support-mediated with no guaranteed date; where the platform's own payments account does not transfer, so settlements keep flowing to the seller across the cutover (price the float and make the cutover a closing condition); or where the check could not be scheduled. Green where owner-level access is demonstrated and the transfer runs on a vendor-published process the seller can point to. Record BLOCKED, not a rating, where the seller would not permit the check.",
  },
  "Live login to listing and social accounts": {
    guidance:
      "Separated from the operating-system check because the severity means something different: losing the point-of-sale stops the business, while losing a listing erodes its demand over months. Confirm administrative access to each account established under the Tier A ownership item, and note any held by a departing employee or an outside agency. Where a rating or review count is being treated as goodwill, establish whether it actually transfers: Google documents that reviews follow the business profile through an ownership transfer; Yelp documents that it may split the page where new owners make a significant name change and says nothing about what happens to the reviews; and at least one major booking marketplace's terms license customer reviews to the platform and attach them to the platform's own profile, import-only, with no documented ownership transfer at all. A star rating that cannot move is a platform-locked, third-party-owned artifact, and a valuation treating it as transferable goodwill is overstating what is being bought.",
    severityGuidance:
      "Red where an account material to demand is controlled outside the transaction with no release agreed, or where bookings are materially sourced from a marketplace profile that the platform's own terms make non-transferable and the valuation treats it as goodwill. Yellow where access is through a personal account, cannot be demonstrated for some accounts, where review or rating continuity across the transfer is undocumented on a platform material to demand, or where the check could not be performed. Green where administrative access to every material account is demonstrated and the platforms material to demand document that the profile and its reviews survive the transfer.",
  },

  // --- Salon ---
  "Booking software contract and client-data export terms": {
    guidance:
      "Record what the contract promises, and treat that as a claim to be verified rather than a finding in itself — the live export check tests what the platform actually produces, and where the two diverge, the divergence is the finding. For a service business the client list and appointment history are the asset being bought; a platform that will only release them as a PDF has effectively made them non-portable whatever the contract says. Read the contract against what the platform's own published documentation says it does, because on the common booking platforms that is materially worse than sellers expect: appointment-history export fails outright on three of the four studied (one documents no appointment export at all, one offers only a chart of counts rather than per-appointment rows unless a paid data add-on is bought, and one publishes no export article at all and directs client-list requests to a support email). Full client migration on one major platform is cancellation-only, paid and owner-only, with 25 days to request it and 30 days to total loss of the data. One platform documents no ownership-transfer process whatsoever and licenses customer reviews to itself. Name the platform, quote its own current documentation, and date the check — these articles change without notice.",
    severityGuidance:
      "Red where the contract does not transfer, where it specifies no obligation to release client data in a usable form, where the platform's published documentation shows the client list is obtainable only as a support-ticket favour with no schema, format or service level, or where no ownership-transfer path is documented at all and the seller cannot obtain one in writing. Yellow where the promised export is limited in scope or format, where appointment history is obtainable only through a paid add-on or by stitching partial reports, where a post-cancellation window (as short as 25 days to even request the data on one platform) will expire before the buyer can extract, where transfer needs consent, or where terms could not be obtained. Green where the agreement transfers and a structured full-history export covering clients and appointments is contractually provided for and corroborated by the platform's own published documentation.",
  },
  "Recurring membership/package liability and transfer terms": {
    guidance:
      "Quantify this rather than describing it. Prepaid packages are service already sold and not yet delivered, and they are frequently the largest liability in a service-business deal that appears nowhere in the financial statements. Get the outstanding balance and the count of active packages out of the booking system, and establish in writing whether the buyer honours them, the seller settles them at close, or they are refunded. Ask separately whether stored payment credentials transfer — assume they do not, across the board, and model the attrition, because every member then has to re-enter card details and some never will. Two mechanics to check against the platform's own documentation rather than the seller's assumption: whether the platform's integrated merchant account transfers at all (at least one major booking platform documents that it does not, that the new owner must apply within 30 days to accept integrated payments, and that transactions processed before the new account is live continue to be deposited into the previous owner's bank account), and how long the gap between the seller's access ending and the buyer's beginning is expected to be. Both are working-capital items, not IT items.",
    severityGuidance:
      "Red where an outstanding prepaid balance material against the purchase price transfers to the buyer with no adjustment, where the balance cannot be quantified from the system, or where recurring billing cannot continue through the ownership change and no re-enrolment plan is funded. Yellow where the amount is quantified but the treatment at close is unagreed, where recurring billing will not carry over, where stored payment credentials do not transfer and the attrition is unmodelled, or where the platform's merchant account does not transfer so settlements keep flowing to the seller across the cutover. Green where the balance is quantified, its treatment is documented in the purchase agreement, and the payments cutover has an agreed date. Materiality is a proportion of the deal, not a fixed figure — state the comparison you used.",
  },
  "Live verification of client record count and booking-platform export": {
    guidance:
      "The client list is the asset being bought in a service business, and the Tier B item records only what the platform is contractually obliged to release. Verify it: have the seller open the booking platform, record the count of active client records and the appointment history depth actually present, then run the export and open what comes out. Compare the count against what the seller represented, the export's format and scope against what the contract promised, and any divergence between the three is the finding. Three traps specific to booking platforms, all vendor-documented. First, the number that matters is the contactable count, not the row count: count non-null and unmasked email and phone values and report both, because a list whose contact details are missing or masked is worth materially less than its row count suggests, and that is a valuation adjustment rather than a technical footnote. Second, appointment history must be per-appointment rows covering all statuses including cancellations and no-shows — a transactions-only reconstruction omits exactly the data that reveals demand quality, and at least one platform's 'appointments summary' is a chart of counts rather than rows. Third, check the permission and the date filter the export ran under: one platform's 'own schedule only' permission silently truncates to a single staff member's calendar and looks complete, and one vendor documents that its customer report rescopes lifetime spend to the selected date range, so a default range yields a truncated list with understated value.",
    severityGuidance:
      "Red where client records cannot be exported in a structured, machine-readable form (PDF, print and screenshots do not qualify), where the count materially contradicts what the seller represented and the discrepancy cannot be explained, where appointment history cannot be exported at all for an appointment-driven business with no funded alternative, or where the platform's post-cancellation data window will close before the buyer can extract. Yellow where the export is limited in scope or format, where appointment history is shallower than represented or obtainable only by stitching partial reports or buying an add-on, where the contactable count is materially below the row count (quantify the gap and treat the marketable list as the smaller number), or where the check could not be performed. Green where the count matches, the export is structured and per-appointment across all statuses, the contactable rate is consistent with the business's stated marketing reach, and coverage reaches the history the contract promised.",
    fieldSchema: DATA_EXPORT_V4_FIELDS,
  },

  // --- E-commerce ---
  "Platform account ownership and transfer mechanics": {
    guidance:
      "Confirm the account of record, not merely that someone can log in. Platform ownership transfer is usually a defined procedure with its own requirements, and it frequently touches the billing relationship and any connected payment account at the same time — a storefront that transfers while its payment account does not is a storefront that cannot take money on day one. Two platform-documented specifics to check rather than assume. An embedded platform loan or cash-advance product blocks or gates the store transfer on the major storefront and point-of-sale platforms, so ask whether one exists and get the payoff scheduled at or before close. And where history is being pulled through the platform's API rather than its dashboard, check the default window: the leading storefront platform returns only 60 days of orders without elevated read access, which is the silent-truncation trap — an export that looks complete but covers two months. Record the date you checked the vendor documentation.",
    severityGuidance:
      "Red where owner-level access sits outside the transaction, where the platform will not transfer the account, or where an embedded platform loan blocks the transfer and is not scheduled for payoff at or before close. Yellow where transfer is possible but procedurally involved, where billing or payment connections need re-establishing so settlements keep flowing to the seller across the cutover, where order history was pulled through an API default window rather than a full export, or where the check could not be performed. Green where owner access is demonstrated, the transfer procedure is confirmed against the vendor's own published documentation, and no embedded financing encumbers it.",
  },
  "Payment gateway PCI compliance scope": {
    guidance:
      "Establish which self-assessment questionnaire the merchant actually falls under, because the scope difference is the whole finding: where card data never touches the merchant's own systems the ongoing obligation is small, and where the merchant handles or stores card data it is substantial and continuing. Ask for the current attestation and check its date. Where the seller does not know which questionnaire applies, that is itself the finding. For dating the framework correctly: the current standard is PCI DSS v4.0.1, published 11 June 2024, with the bulk of its future-dated requirements effective from 31 March 2025. Where you intend to cite a specific requirement to the client — the certificate-inventory requirement is the most diligence-relevant hook — quote it from the standard itself rather than from a secondary summary; the wording circulating in third-party articles has not been verified against the published document. The one PCI statement safe to quote from a primary source is the Council's own FAQ #1491 (updated July 2026): PCI DSS 'does not consider SSL or early TLS to be strong cryptography', with migration required since 30 June 2018.",
    severityGuidance:
      "Red where card data is handled or stored by merchant-controlled systems with no current attestation, where the merchant's obligations are plainly unmet, or where SSL or early TLS is still in use for any transmission of account data. Yellow where an attestation has lapsed, where the applicable scope cannot be established, or where the compliance obligation is broader than the buyer expects. Green where a current attestation is on file for a narrow scope. Record that this is a scoping review and not a compliance assessment, and state the standard version you assessed against — v4.0.1 (11 June 2024) at the time of writing — since the framework is revised and the assessment should be readable against the version it used.",
  },
};

/**
 * v3 items this revision deliberately leaves exactly as they are, with the reason.
 *
 * The research covers five topics. Nine items sit outside all five, and saying so explicitly is
 * part of the deliverable: a reader of this file should be able to tell "the evidence did not move
 * this" apart from "nobody looked". `assertThresholdCoverage` turns a missing decision into a build
 * failure, so an item cannot silently skip the pass.
 */
const UNCHANGED_FROM_V3: Record<string, string> = {
  "CMS identification and version/patch status":
    "Outside the research's five topics. v3's rule — never convert a version string into a vulnerability claim, reserve Red for something independently confirmed — is the correct posture and nothing in the evidence base revises it.",
  "Social account ownership":
    "The research's platform findings concern reviews and marketplace profiles, which are rated on the Google Business Profile item and the Tier C listing/social login item. Nothing in it bears on who administers a social handle.",
  "Primary business-system contract terms, term length, early-termination penalty":
    "Outside the five topics. The contract-reading procedure and the deal-relative materiality rule stand; the research's contract findings are specific to merchant processing agreements and are applied on the payment items instead.",
  "Recurring SaaS inventory":
    "Outside the five topics. No published source bears on it, and v3 already refuses to set a fixed dollar threshold for materiality.",
  "Live login to hosting/CMS admin":
    "The research's live-access findings concern operating systems and their data (the primary-operating-system and data-export items). Nothing in it bears on hosting or CMS admin transfer specifically.",
  "Online-ordering platform contract and transferability clause":
    "The restaurant findings in the research concern Toast as the point-of-sale and data source, which land on the primary-operating-system login and data-export items. Nothing in it bears on the terms of an online-ordering agreement.",
  "POS-to-online-ordering integration health":
    "Outside the five topics. v3's procedure — observe a test order end to end rather than accept that an integration is configured — is unaffected.",
  "Third-party delivery platform account ownership and menu sync":
    "Outside the five topics. No published threshold exists for menu drift or listing accuracy, and v3 correctly rates on control and accuracy rather than a number.",
  "Franchisor-mandated technology stack compliance":
    "Outside the five topics. Franchise agreements were not researched; v3's rule that materiality is stated as a comparison rather than a fixed figure is the right shape in the absence of evidence.",
  "Franchise-system SSO and account transfer process":
    "Outside the five topics. The platform transfer findings are vendor-specific to the studied POS, booking and storefront platforms and do not extend to franchisor systems.",
  "Customer-facing platform contract and transferability":
    "Shared title across the franchise and e-commerce templates, each with its own vertical wording. The research's storefront findings are about transfer mechanics and API history windows, which are rated on the Tier C platform item; the contract terms themselves were not researched.",
  "Installed app/plugin inventory and licensing":
    "Outside the five topics. v3's rule — take the inventory from the live admin, not a document — stands unaltered.",
};

// ---------------------------------------------------------------------------
// New items introduced in v4
// ---------------------------------------------------------------------------

/**
 * Added to every template. All three are universal: every business sends mail from a domain, and
 * every business that takes cards has an acquirer relationship and a principal whose terminated-
 * merchant status is a fact about the deal rather than about the vertical.
 */
const V4_NEW_ITEMS: TemplateItemInput[] = [
  {
    tier: Tier.A,
    method: CheckMethod.MANUAL,
    title: "Authentication verdicts on a real message from the business's sending system",
    description:
      "The authentication result a receiving mail system actually returns for a genuine message sent by the business — the signing domain and key, and whether the message passes alignment checks.",
    guidance:
      "This is the artifact without which DKIM cannot be graded at all. DKIM has no discovery mechanism: selectors cannot be enumerated from public DNS, so a not-found result at a guessed selector proves nothing, and rating a domain Red for 'no DKIM' on probed selectors is an indefensible finding to put in a billable report. The only reliable method is a real message. Obtain one from the business's primary sending system — an order confirmation, a booking reminder, an invoice, or a marketing send, ideally the same system that sends the mail whose delivery actually earns revenue — to a mailbox you control, and retain the raw source. Read the DKIM-Signature header for the selector (s=) and signing domain (d=), then retrieve that selector's DNS record and measure the key by decoding its p= value. Read the receiving system's own Authentication-Results header for its spf=, dkim= and dmarc= verdicts: a receiver-generated verdict on a real message beats any amount of DNS inspection and is the single highest-value artifact in the whole email check. Check that d= aligns with the visible From domain — SPF authenticates the envelope sender and DKIM authenticates a signing domain, and neither constrains what the recipient actually sees in the From header, which is the whole reason DMARC exists. Where the business sends through several systems (a storefront, a booking platform, a newsletter tool), one message per system is the honest scope, and say which you covered. Attach the raw headers as evidence; a verdict recorded without them cannot be re-checked by anyone.",
    severityGuidance:
      "Red where a message from the primary sending system carries no DKIM signature at all, where the key is under 1024 bits, or where signing uses rsa-sha1 — RFC 8301 §3.2 requires signers to use RSA keys of at least 1024 bits, says they should use at least 2048, and states that rsa-sha1 MUST NOT be used, with verifiers required to treat sub-1024-bit signatures as invalid. Red also where the receiver's own Authentication-Results shows dmarc=fail on legitimate business mail, which means the domain's own transactional mail is failing the policy it publishes. Yellow where the signature verifies at 1024 bits (meeting RFC 8301's MUST but failing its SHOULD and NIST SP 800-177r1 Table 4-3's recommendation of 2048 bits with a one-to-two-year key lifetime); where there is no evidence of key rotation within 24 months (M3AAWG recommends at least every six months — cite M3AAWG for the cadence only, since the SPF/DKIM/DMARC checklist widely attributed to its Sender Best Common Practices does not appear in the current version); where the signing key is held by a third party that also signs for other clients; or where a former vendor's selector is still live in DNS. Yellow, not Green, where no message could be obtained: the DKIM half of the email posture is then simply ungraded, and the report should say so rather than implying it passed. Green where a signature verifies on a real message at 2048-bit RSA or ed25519 with rsa-sha256, d= aligned to the visible From domain, and the receiver reports dmarc=pass.",
    fieldSchema: TEST_MESSAGE_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.NONE,
    sortOrder: 43,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Terminated-merchant file (MATCH / VMSS) exposure",
    description:
      "Whether the business or any principal owner appears on the card networks' terminated-merchant files — a listing that can prevent a new merchant account being underwritten for the buyer after close.",
    guidance:
      "Split out from general account standing because the evidence is different and the consequence is different: this is not answerable from statements. Merchants cannot search the file themselves — access is limited to acquirers and processors — so the routes are the seller's own acquirer, or the mailbox Mastercard publishes for merchant enquiries (matchbusinessowner@mastercard.com). The listing is written by the acquirer, which must add a terminated merchant within one business day, and it records the business and the principal owner's name, address, phone number and tax ID; removal is available only from the listing acquirer and only for an error or a cured reason code. Require the seller and every principal owner to represent in the purchase agreement that neither the business nor they personally are listed on Mastercard's MATCH or Visa's VMSS, and where the seller does not know their status, direct them to their acquirer. Do not accept a 'letter of good standing' as a substitute for any of this — it is not a defined card-network instrument, no authoritative source establishes it as a standard processor-issued document, and no processor is obliged to produce one. The substitute is a seller-authorised written inquiry to the acquirer plus the purchase-agreement representation.",
    severityGuidance:
      "WHY THIS IS THE STRONGEST RED CANDIDATE IN PAYMENT DILIGENCE AT THIS DEAL SIZE. A MATCH listing lasts five years before automatic removal, attaches to the principal personally as well as to the business, survives closure of the account, and survives later winning the disputes — in the words of Stripe's published documentation on terminated merchant files, which describes obligations Stripe is bound by as a licensed acquirer, 'winning or reversing the chargebacks later doesn't alter this status'. Reason Code 04, Excessive Chargebacks, triggers where monthly Mastercard chargebacks exceed 1% of monthly Mastercard sales AND total USD 5,000 or more in the same month, with no minimum chargeback count at all; the worked example in that documentation is 125 transactions with 6 chargebacks totalling $6,250. That is trivially reachable for a small business, and it is far below Mastercard's Excessive Chargeback floor of 100 chargebacks or Visa's monitoring floor of 1,500 events — which is exactly why this item exists separately from those. Reason Code 05, Excessive Fraud, is fraud-to-sales of 8% or more with at least 10 fraudulent transactions and at least USD 5,000. Visa's equivalent file, VMSS, is confirmed in Visa's Core Rules (18 April 2026 edition) §10.17, which requires acquirers to list terminated merchants, to notify the merchant in writing, and to inform them of subject-access rights; VMSS Code 21 (Excessive Fraud) is USD 250,000 and 180 bps in a month and Code 22 (Excessive Disputes) is 1,000 disputes and 180 bps. Note that the five-year retention figure for VMSS comes from a processor's documentation and not from Visa's own rules, which are silent on it — do not state it as a Visa rule.\n\nRED: a confirmed listing of the business or any principal; or the seller or any principal declining to make the representation, regardless of what the statements show. That refusal is a stronger signal than the underlying data, and it is decisive where the principal will be retained after close as an operator, guarantor or earn-out counterparty, because a listed principal can make card processing unobtainable for the buyer's entity.\n\nYELLOW: status not yet established at the time of rating with the inquiry open; or a historical acquirer termination in the business's history whose MATCH consequence has not been established.\n\nGREEN: the representation obtained in writing from the entity and every principal owner, and nothing in the trailing statements or acquirer correspondence suggesting a terminating event.",
    fieldSchema: TERMINATED_MERCHANT_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
    sortOrder: 92,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Processing continuity at close",
    description:
      "Whether the business can keep taking card payments through the change of ownership: what the existing merchant agreement permits, what the buyer must obtain in its own name, and who carries the cost of the gap.",
    guidance:
      "Split out from account standing because it is a closing dependency and a working-capital item rather than a risk measurement. Read the assignment clause and the change-of-ownership clause together. Standard-form merchant processing agreements bar the merchant from assigning without the bank's written consent while permitting the bank to assign freely, and commonly define a change of more than 25% of legal or beneficial ownership as an event of default carrying an advance-notice obligation — quote the target's own agreement rather than a general statement. Plan on the buyer applying for a new merchant account and a new merchant ID under the acquiring entity, with full re-underwriting including terminated-merchant-file and OFAC screening of the buyer and its principals; the OCC's merchant-processing handbook describes those checks as standard industry practice. Quantify the gap explicitly rather than treating approval as an administrative afterthought: days without processing, the deposit-hold terms a newly underwritten account carries, any up-front reserve a new merchant is likely to be assigned, and whether current pricing rests on a legacy rate card that will not survive re-underwriting. Establish in writing who bears chargeback liability on pre-close transactions that dispute after close, because those land on the seller's merchant ID and the seller's reserve. Where the operating platform's own payments product is in use, check it separately — at least one major booking platform documents that the merchant account does not transfer and that transactions processed before the new account is live continue depositing into the previous owner's bank account.",
    severityGuidance:
      "Red where processing continuity is assumed rather than evidenced; where no application has been started against the closing timetable; where pricing depends on a legacy rate card that will not survive re-underwriting; where an active reserve is unaddressed in the purchase agreement; or where liability for pre-close transactions that dispute after close is unallocated. Yellow where the buyer's application is in progress with no approval date; where the new account's deposit hold or up-front reserve is unquantified; where the ownership-change clause has been read but consent has not been requested; or where the platform's payments account will not transfer so settlements keep flowing to the seller across the cutover (price the float and make the cutover a dated closing condition). Green where the buyer's account is approved or in underwriting against a date, pricing is quoted on the buyer's own underwriting, and pre-close dispute liability and any reserve balance are allocated in the purchase agreement. There is no published standard for how long re-underwriting takes or what a new account's reserve will be — use the acquirer's own quoted figures, date them, and say whose they are rather than offering an industry norm that does not exist.",
    fieldSchema: PROCESSING_CONTINUITY_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
    sortOrder: 94,
  },
];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export const V4_CHANGE_NOTE =
  "Severity thresholds re-sourced to primary publications and dated: the fixed 30-day certificate " +
  "rule replaced with the CA/Browser Forum validity schedule and the one-third-of-lifetime renewal " +
  "norm; the retired Visa VDMP/VFMP numbers replaced with VAMP and Mastercard ECM/HECM as published, " +
  "with terminated-merchant-file (MATCH/VMSS) exposure and processing continuity at close split out " +
  "as their own items; trademark rating moved off Nice class onto the identification wording, with " +
  "the current register, search system and classification edition named; email authentication " +
  "re-stated against RFC 9989 and the published mailbox-provider mandates, with a real-message " +
  "authentication check added so DKIM is graded on evidence rather than guessed selectors; domain " +
  "posture re-stated against the ICANN Transfer Policy in force, with the expiry threshold labelled " +
  "as this firm's stated basis rather than an industry standard; and the data-export item extended " +
  "to capture contactable-versus-row count, history depth and the post-close access window.";

function revise(item: TemplateItemInput): TemplateItemInput {
  // Object.hasOwn for the same reason enrich() uses it (src/lib/templates/evidenceDepth.ts): a bare
  // index on a plain object literal answers for Object.prototype, so an item titled `constructor`
  // would be "revised" by spreading a function over it.
  const revision = Object.hasOwn(REVISIONS, item.title) ? REVISIONS[item.title] : undefined;
  return revision ? { ...item, ...revision } : item;
}

/** Every title the v3 build produces, across every template. */
function v3Titles(): string[] {
  const titles = TEMPLATE_DEFINITIONS.flatMap((definition) =>
    buildEvidenceDepthItems(definition.slug, definition.specificItems).map((item) => item.title),
  );
  return [...new Set(titles)];
}

/**
 * Fails the build if any v3 item was not consciously passed over in this revision.
 *
 * v4's whole subject is that guidance written from domain knowledge goes stale silently. An item
 * that nobody re-read against the evidence base looks exactly like one that was re-read and left
 * alone, which is the state this assertion exists to make impossible: every carried-forward item is
 * either revised or recorded in UNCHANGED_FROM_V3 with the reason the evidence does not move it.
 *
 * It also fails on a key that matches no v3 item. Both maps are keyed by title, so a renamed or
 * retired upstream item would otherwise leave a revision silently applying to nothing — the
 * failure mode that the coverage check itself would mask.
 */
export function assertThresholdCoverage() {
  const titles = v3Titles();
  const known = new Set(titles);

  const undecided = titles.filter(
    (title) => !Object.hasOwn(REVISIONS, title) && !Object.hasOwn(UNCHANGED_FROM_V3, title),
  );
  if (undecided.length > 0) {
    throw new Error(
      `Template v4 has no threshold decision for: ${undecided.join("; ")}. Add an entry to ` +
        "REVISIONS, or record it in UNCHANGED_FROM_V3 with the reason the evidence does not move it.",
    );
  }

  const bothWays = Object.keys(REVISIONS).filter((title) => Object.hasOwn(UNCHANGED_FROM_V3, title));
  if (bothWays.length > 0) {
    throw new Error(
      `Template v4 both revises and declares unchanged: ${bothWays.join("; ")}. Pick one.`,
    );
  }

  const stale = [...Object.keys(REVISIONS), ...Object.keys(UNCHANGED_FROM_V3)].filter(
    (title) => !known.has(title),
  );
  if (stale.length > 0) {
    throw new Error(
      `Template v4 keys no v3 item: ${stale.join("; ")}. The upstream title changed or the item ` +
        "was retired — a revision keyed to nothing applies to nothing.",
    );
  }
}

/** Builds the full v4 item set for one template slug. */
export function buildEvidenceBackedItems(
  slug: string,
  specificItems: TemplateItemInput[],
): TemplateItemInput[] {
  assertThresholdCoverage();

  const items = [
    ...buildEvidenceDepthItems(slug, specificItems).map(revise),
    ...V4_NEW_ITEMS,
  ];
  return items.sort((a, b) => a.sortOrder - b.sortOrder);
}
