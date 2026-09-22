/**
 * Template v3 — "evidence depth".
 *
 * WHAT THIS VERSION CHANGES
 * -------------------------
 * v1 and v2 asked the right questions and gave the consultant one free-text box to answer them in.
 * Three items — the ones whose titles happened to contain the word "contract" — got three fixed
 * structured fields; the other five Tier B items got nothing. docs/spec.md §4 is explicit that
 * this is the gap: "The product's job is to turn 'here's a PDF contract' into a structured,
 * comparable finding ... rather than just storing an attachment."
 *
 * v3 gives every manual item:
 *   - a declared `fieldSchema` where there is something structured worth capturing,
 *   - `guidance` — how to actually perform the check,
 *   - `severityGuidance` — when it is Red vs Yellow vs Green, with the threshold's source,
 *   - `evidenceExpectation` and `blockingDependency`, so the product can say which items are not
 *     runnable at the consultant's current deal stage and which ratings have nothing behind them.
 *
 * It also closes three methodology defects found reviewing v2 against docs/spec.md §4–5:
 *   1. §4's base Tier B table lists platform-contract transferability as a universal item, but the
 *      implementation put the online-ordering half in the restaurant template and the booking half
 *      in the salon template — so franchise and e-commerce silently had no transferability item at
 *      all. This is the exact failure the audit-methodology skill warns about. v3 gives those two
 *      templates their own vertical-appropriate instance, and `templates.test.ts` asserts every
 *      template has one so the class of regression can't come back.
 *   2. "Live login to POS/booking/GBP/socials" bundled four unrelated systems into one pass/fail
 *      with one severity. A Red on socials and a Red on the POS are not the same finding, and
 *      §6's roll-up ("any single Red makes its tier Red") cannot distinguish them. v3 splits it.
 *   3. The salon template had no Tier C item at all, for a business whose entire value is a client
 *      list living inside a booking platform — and its Tier B item records only what the platform
 *      is *contractually required* to export, with nothing verifying that it does.
 *
 * WHY THIS IS A SEPARATE ARRAY AND NOT AN EDIT
 * -------------------------------------------
 * docs/spec.md §5: an in-progress Audit stays pinned to the Template version it started on, because
 * mid-engagement checklist changes would silently invalidate findings a consultant already
 * recorded and already rated. So v1/v2 content in content.ts is frozen — including its defects —
 * and improvements arrive as a new version. Audits already running stay on the version they were
 * rated against; only new audits see v3.
 */

import { BlockingDependency, CheckMethod, EvidenceExpectation, Tier } from "@prisma/client";

import {
  BASE_TEMPLATE_ITEMS,
  ECOMMERCE_SPECIFIC_ITEMS,
  FRANCHISE_SPECIFIC_ITEMS,
  RESTAURANT_SPECIFIC_ITEMS,
  SALON_SPECIFIC_ITEMS,
  TIER_A_EXPANSION_ITEMS,
} from "./content";
import type { TemplateItemInput } from "./publish";
import type { ItemFieldSchema } from "./fieldSchema";

// ---------------------------------------------------------------------------
// Reusable option sets
// ---------------------------------------------------------------------------

/**
 * "unclear" is a first-class answer everywhere, not an omission.
 *
 * In a live deal the honest state of most document-derived questions is "the contract doesn't say"
 * — and a consultant who can only choose yes or no will pick one, which manufactures certainty the
 * evidence doesn't support. An explicit `unclear` is also what makes the field aggregate honestly
 * across audits later.
 */
const TRANSFERABILITY = ["transfers", "consent-required", "does-not-transfer", "unclear"] as const;
const YES_NO_UNCLEAR = ["yes", "no", "unclear"] as const;

// ---------------------------------------------------------------------------
// Field schemas, per item
// ---------------------------------------------------------------------------

const PRIMARY_CONTRACT_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "vendor", label: "Vendor / system", kind: "text", placeholder: "e.g. Toast, Square, Mindbody" },
    { key: "monthlyCost", label: "Monthly cost", kind: "money", placeholder: "e.g. 165" },
    { key: "termEndDate", label: "Current term ends", kind: "date" },
    { key: "autoRenews", label: "Auto-renews", kind: "enum", options: [...YES_NO_UNCLEAR] },
    {
      key: "cancellationNotice",
      label: "Cancellation notice required",
      kind: "text",
      placeholder: "e.g. 90 days before renewal",
      help: "The deadline, not just the duration — a 90-day notice window on a term ending in 60 days has already closed.",
    },
    {
      key: "transferable",
      label: "Transfers to the buyer",
      kind: "enum",
      options: [...TRANSFERABILITY],
      help: "'consent-required' is the common real answer and is materially different from 'transfers' — it hands the vendor a veto over the close.",
    },
    { key: "penaltyAmount", label: "Early-termination penalty", kind: "money" },
    {
      key: "penaltyBasis",
      label: "Penalty basis",
      kind: "text",
      placeholder: "e.g. flat fee, remaining months × monthly fee",
    },
  ],
};

const PAYMENT_PROCESSOR_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "processor", label: "Processor", kind: "text", placeholder: "e.g. Square, Stripe, Elavon" },
    {
      key: "statementPeriod",
      label: "Statement period reviewed",
      kind: "text",
      placeholder: "e.g. Jan–Jun 2026",
      help: "Record the window you actually saw. A clean single month proves much less than six.",
    },
    { key: "chargebackRate", label: "Chargeback rate", kind: "percent", placeholder: "e.g. 0.45" },
    { key: "chargebackCount", label: "Chargebacks in period", kind: "text", placeholder: "e.g. 14" },
    { key: "reserveHeld", label: "Rolling reserve held", kind: "money" },
    {
      key: "accountStatus",
      label: "Account standing",
      kind: "enum",
      options: ["good-standing", "reserve-held", "under-review", "terminated", "unclear"],
    },
  ],
};

const SAAS_INVENTORY_FIELDS: ItemFieldSchema = {
  // docs/spec.md §4 specifies this item literally as a "structured table the consultant fills from
  // a seller-provided list". v1/v2 rendered it as a single free-text box.
  fields: [
    {
      key: "tools",
      label: "Recurring tools and subscriptions",
      kind: "table",
      help: "One row per recurring charge. The rebuild column is the one the buyer's first 90 days depend on.",
      columns: [
        { key: "tool", label: "Tool", kind: "text", placeholder: "e.g. Mailchimp" },
        { key: "monthlyCost", label: "Monthly cost", kind: "money" },
        { key: "billedTo", label: "Billed to", kind: "text", placeholder: "owner's personal card?" },
        { key: "transfers", label: "On sale", kind: "enum", options: ["transfers", "must-rebuild", "unclear"] },
        { key: "contractEnd", label: "Term ends", kind: "date" },
      ],
    },
  ],
};

/** Shared by every Tier C item: what was actually done, by whom, and what was seen. */
const ATTESTATION_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "systemChecked",
      label: "System checked",
      kind: "text",
      placeholder: "e.g. Toast back-office, admin.toasttab.com",
    },
    { key: "performedOn", label: "Performed on", kind: "date" },
    {
      key: "accessLevel",
      label: "Access level observed",
      kind: "enum",
      options: ["owner", "admin", "limited", "none", "unclear"],
      help: "Whether the seller could actually hand over owner-level control, not just whether a login worked.",
    },
    {
      key: "observation",
      label: "What was observed",
      kind: "longtext",
      placeholder: "What you did, what you saw, and anything the seller could not demonstrate.",
      help: "This is the attestation. It is the product's answer to 'why don't you do the login yourselves' — a named professional's on-the-record account of what they saw.",
    },
  ],
};

const DATA_EXPORT_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "systemChecked", label: "System exported from", kind: "text" },
    { key: "performedOn", label: "Performed on", kind: "date" },
    {
      key: "exportFormat",
      label: "Format received",
      kind: "enum",
      options: ["csv-or-excel", "api", "pdf-only", "screenshot-only", "none", "unclear"],
      help: "PDF-only and screenshot-only are effectively non-portable — the buyer cannot load them into a replacement system.",
    },
    {
      key: "exportScope",
      label: "History covered",
      kind: "enum",
      options: ["full-history", "limited-window", "current-state-only", "unclear"],
      help: "A CSV of the last 90 days is not an export of five years of transactions.",
    },
    {
      key: "recordsCovered",
      label: "Record types included",
      kind: "text",
      placeholder: "e.g. customers, transactions, appointments",
    },
    { key: "observation", label: "What was observed", kind: "longtext" },
  ],
};

const GBP_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "claimStatus",
      label: "Listing claim status",
      kind: "enum",
      options: ["claimed-by-seller", "claimed-by-third-party", "unclaimed", "unclear"],
      help: "'claimed-by-third-party' — a former agency or a departed manager — is the finding that most often costs the buyer real revenue while it is unresolved.",
    },
    { key: "listingUrl", label: "Listing URL", kind: "text" },
    { key: "reviewCount", label: "Reviews at time of check", kind: "text" },
    { key: "observation", label: "Notes", kind: "longtext" },
  ],
};

const SOCIAL_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "accounts",
      label: "Social and listing accounts",
      kind: "table",
      help: "Cover at least the platforms the business actually markets on. Record the ones that do NOT exist too — an unclaimed handle is a squatting risk the buyer inherits.",
      columns: [
        { key: "platform", label: "Platform", kind: "text", placeholder: "e.g. Instagram" },
        { key: "handle", label: "Handle / URL", kind: "text" },
        {
          key: "control",
          label: "Administered by",
          kind: "enum",
          options: ["seller", "employee", "agency", "unknown", "does-not-exist"],
        },
        { key: "transfers", label: "Transfers", kind: "enum", options: [...YES_NO_UNCLEAR] },
      ],
    },
  ],
};

const TRADEMARK_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "markSearched", label: "Mark searched", kind: "text" },
    {
      key: "registersSearched",
      label: "Registers searched",
      kind: "text",
      placeholder: "e.g. USPTO federal, state of CA, common-law web search",
    },
    {
      key: "federalStatus",
      label: "Federal registration held by seller",
      kind: "enum",
      options: ["registered", "pending", "none-found", "unclear"],
    },
    {
      key: "conflictsFound",
      label: "Potential conflicts found",
      kind: "enum",
      options: ["none-found", "similar-different-class", "similar-same-class", "unclear"],
      help: "Same-class similarity is the one that matters. Different-class similarity is usually coexistence, not conflict.",
    },
    { key: "observation", label: "What was found", kind: "longtext" },
  ],
};

const MEMBERSHIP_LIABILITY_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "outstandingBalance",
      label: "Outstanding prepaid balance",
      kind: "money",
      help: "Often the single largest undisclosed liability in a salon or studio deal — service already sold and not yet delivered.",
    },
    { key: "activePackages", label: "Active prepaid packages", kind: "text" },
    { key: "activeMemberships", label: "Active recurring memberships", kind: "text" },
    { key: "monthlyRecurringRevenue", label: "Membership MRR", kind: "money" },
    {
      key: "liabilityOnTransfer",
      label: "Who carries the liability at close",
      kind: "enum",
      options: ["transfers-to-buyer", "seller-honors", "refunded-at-close", "unclear"],
    },
    {
      key: "billingTransfers",
      label: "Recurring billing transfers",
      kind: "enum",
      options: [...TRANSFERABILITY],
      help: "Stored card credentials very often do NOT transfer — every member may have to re-enter payment details, and some never will.",
    },
  ],
};

const FRANCHISOR_STACK_FIELDS: ItemFieldSchema = {
  fields: [
    {
      key: "systems",
      label: "Franchisor-mandated systems",
      kind: "table",
      columns: [
        { key: "system", label: "System", kind: "text", placeholder: "e.g. POS, loyalty, scheduling" },
        { key: "vendor", label: "Mandated vendor", kind: "text" },
        { key: "monthlyCost", label: "Monthly cost", kind: "money" },
        {
          key: "substitution",
          label: "Buyer may substitute",
          kind: "enum",
          options: ["yes", "with-approval", "no", "unclear"],
        },
      ],
    },
    {
      key: "transferConsent",
      label: "Franchisor consent required to transfer",
      kind: "enum",
      options: [...YES_NO_UNCLEAR],
    },
    { key: "transferFee", label: "Technology/transfer fee", kind: "money" },
  ],
};

const PCI_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "gateway", label: "Gateway / processor", kind: "text" },
    {
      key: "saqType",
      label: "SAQ type",
      kind: "enum",
      options: ["A", "A-EP", "B", "B-IP", "C", "C-VT", "P2PE", "D", "unclear"],
      help: "SAQ A means card data never touches the merchant's systems. SAQ D is the broad-scope one and implies materially more ongoing obligation for the buyer.",
    },
    {
      key: "attestationOnFile",
      label: "Current attestation on file",
      kind: "enum",
      options: [...YES_NO_UNCLEAR],
    },
    { key: "attestationExpiry", label: "Attestation expires", kind: "date" },
    {
      key: "liabilitySitsWith",
      label: "Liability sits with",
      kind: "enum",
      options: ["gateway", "merchant", "shared", "unclear"],
    },
  ],
};

const PLATFORM_CONTRACT_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "platform", label: "Platform", kind: "text" },
    {
      key: "transferable",
      label: "Transfers to the buyer",
      kind: "enum",
      options: [...TRANSFERABILITY],
    },
    { key: "termEndDate", label: "Current term ends", kind: "date" },
    { key: "monthlyCost", label: "Monthly / platform cost", kind: "money" },
    { key: "commissionRate", label: "Commission or take rate", kind: "percent" },
    { key: "penaltyAmount", label: "Early-termination penalty", kind: "money" },
    {
      key: "customerDataOwnership",
      label: "Customer data belongs to",
      kind: "enum",
      options: ["merchant", "platform", "shared", "unclear"],
      help: "On marketplace-style platforms the customer relationship frequently belongs to the platform, which caps what the buyer is actually acquiring.",
    },
  ],
};

const BOOKING_CONTRACT_FIELDS: ItemFieldSchema = {
  fields: [
    { key: "platform", label: "Booking platform", kind: "text" },
    { key: "transferable", label: "Transfers to the buyer", kind: "enum", options: [...TRANSFERABILITY] },
    { key: "termEndDate", label: "Current term ends", kind: "date" },
    { key: "monthlyCost", label: "Monthly cost", kind: "money" },
    {
      key: "exportFormat",
      label: "Contractual export format",
      kind: "enum",
      options: ["csv-or-excel", "api", "pdf-only", "none-specified", "unclear"],
      help: "What the contract PROMISES. The Tier C item verifies what it actually produces — record both, and flag any gap.",
    },
    {
      key: "exportScope",
      label: "Contractual export scope",
      kind: "enum",
      options: ["full-history", "limited-window", "current-state-only", "none-specified", "unclear"],
    },
    { key: "penaltyAmount", label: "Early-termination penalty", kind: "money" },
  ],
};

// ---------------------------------------------------------------------------
// Per-item enrichment, keyed by the v2 title it applies to
// ---------------------------------------------------------------------------

type Enrichment = Partial<
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

/**
 * Applied by title. Any title present in v2 and missing here keeps its v2 text and gains no
 * structured capture — `assertEnrichmentCoverage` below turns that into a build failure rather
 * than a silent gap, so adding an item without deciding its guidance is not possible.
 */
const ENRICHMENTS: Record<string, Enrichment> = {
  // --- Tier A, automated. No fieldSchema: structuredData holds the runner's output. ---
  "Domain and registrar ownership, expiration": {
    description:
      "Registrar of record, registrant organisation, and expiry date for the primary domain, from the registration record.",
    guidance:
      "Automated. Read the registrant organisation against the legal entity being sold — a domain registered to the owner personally, to a former web developer, or to a marketing agency is a transfer problem even when every other answer is clean. Note the registrar: some resellers make transfers materially harder than others.",
    severityGuidance:
      "Red if the domain is expired, expires inside 30 days, or the registrant is a third party outside the transaction. Yellow if it expires inside 90 days, the registrant is the owner personally rather than the entity, or privacy shielding makes the registrant unverifiable. Green otherwise. Note separately if a registrant change is planned at close: ICANN's transfer policy imposes a 60-day lock after a change of registrant, which can strand the domain past a closing date.",
    blockingDependency: BlockingDependency.NONE,
  },
  "DNS provider and hosting fingerprint": {
    description: "Nameservers, address records, and the hosting and DNS providers they indicate.",
    guidance:
      "Automated. The question behind it is who the buyer will have to get an account from on day one. Nameservers pointing at an agency's account, or at a provider the seller cannot name, is the finding — not the technology itself.",
    severityGuidance:
      "Severity follows transfer risk, not technology choice. Red if DNS is controlled by a party outside the transaction with no established transfer path. Yellow if the provider is unidentifiable from public records, or DNS and hosting sit with different uncontactable parties. Green if both resolve to accounts the seller can demonstrate control of.",
    blockingDependency: BlockingDependency.NONE,
  },
  "SSL/TLS certificate validity, issuer, expiration": {
    description: "Live TLS handshake against the primary domain: certificate validity, issuer, and expiry.",
    guidance:
      "Automated. A lapsed certificate is rarely important in itself — it is a maintenance signal. What matters for the buyer is whether anyone is currently responsible for renewing it.",
    severityGuidance:
      "Red if the certificate is expired, invalid for the domain, or the handshake fails. Yellow if it expires inside 30 days or is self-signed. Green otherwise. Automated renewal (a short-lived certificate from an ACME issuer) is a positive signal worth noting in the finding.",
    blockingDependency: BlockingDependency.NONE,
  },
  "CMS identification and version/patch status": {
    description:
      "Best-effort platform identification from the public homepage. Version fingerprints are indicative and are not asserted as vulnerability findings.",
    guidance:
      "Automated, best-effort. Do not convert a version string into a vulnerability claim — public fingerprints are frequently stale or spoofed, and a claim you cannot substantiate is the one a buyer's own advisor will use to discount the whole report. Record what was observed and, if it matters to the deal, verify under Tier C.",
    severityGuidance:
      "Yellow when the platform is identifiable and the fingerprint suggests an unmaintained major version, or the platform implies a bespoke build with no evident maintainer. Green when the platform is a maintained hosted service. Reserve Red for something independently confirmed, not inferred from a version string.",
    blockingDependency: BlockingDependency.NONE,
  },
  "Email authentication posture (SPF / DMARC; DKIM best-effort)": {
    description:
      "SPF and DMARC records for the business domain. DKIM is probed at common selector names only; a not-found DKIM result is treated as inconclusive and does not affect the rating.",
    guidance:
      "Automated. This is a transferable operational risk, not a cosmetic one: since 2024 the large mailbox providers require bulk senders to authenticate, so a domain with no SPF or a DMARC policy of none hands the buyer a deliverability problem on day one, and it is the buyer who will be blamed for it. DKIM selectors cannot be enumerated from public DNS — say what was probed and rate on SPF and DMARC, which are deterministic.",
    severityGuidance:
      "Red if there is no SPF record, or SPF is malformed or has multiple conflicting records. Yellow if SPF exists but there is no DMARC record, or DMARC is present at p=none (monitoring only, no enforcement). Green at p=quarantine or p=reject with a valid SPF. A missing DKIM record on its own never lowers the rating.",
    blockingDependency: BlockingDependency.NONE,
  },
  "Mail provider fingerprint": {
    description: "Mail exchange records for the domain, and the mail provider they indicate.",
    guidance:
      "Automated. A transfer-complexity signal. Registrar-bundled or self-hosted mail is materially harder to hand over than a managed provider, and mail hosted inside a departing employee's personal account is a finding in its own right.",
    severityGuidance:
      "Yellow if mail is self-hosted, registrar-bundled, or absent entirely while the business advertises an email address on that domain. Green for a managed provider the seller can demonstrate administrative control of. Red only where the records show mail is delivered somewhere outside the seller's control.",
    blockingDependency: BlockingDependency.NONE,
  },
  "HTTPS hygiene": {
    description:
      "Whether plain HTTP redirects to HTTPS, and whether a strict-transport-security header is present. Observed, not asserted as a vulnerability.",
    guidance:
      "Automated. Low individual weight. Its value is corroborative — combined with an unmaintained platform fingerprint and a lapsed certificate it evidences an absence of anyone maintaining the site, which is the finding a buyer can act on.",
    severityGuidance:
      "Yellow if HTTP does not redirect to HTTPS, particularly where the site takes payment or bookings. Green if the redirect is enforced. A missing strict-transport-security header is worth noting but is not on its own a Yellow.",
    blockingDependency: BlockingDependency.NONE,
  },
  "Google Business Profile ownership and claim status": {
    description:
      "Whether the business listing is claimed, and by whom, to the extent publicly determinable.",
    guidance:
      "Manual — there is no public interface that reports claim status, so this is done by inspection. Search the business, open the listing, and look for the owner-response and 'own this business?' signals. Where the seller can screen-share the listing dashboard, prefer that and record it here. For a local business the listing is frequently a larger revenue driver than the website, and it is the asset most often left behind at close.",
    severityGuidance:
      "Red if the listing is administered by a third party outside the transaction (a former agency or departed manager) with no agreed transfer path, or if a duplicate or competing listing is capturing traffic. Yellow if claim status cannot be determined, or the listing is unclaimed and therefore open to being claimed by someone else. Green if the seller demonstrates administrative control and the listing is accurate.",
    fieldSchema: GBP_FIELDS,
    evidenceExpectation: EvidenceExpectation.NONE,
    blockingDependency: BlockingDependency.NONE,
  },
  "Social account ownership": {
    description:
      "Which social and listing accounts exist for the business, who administers them, and whether they transfer.",
    guidance:
      "Manual, from public information plus what the seller confirms. Cover at least the platforms the business actually markets on, and record the platforms where no account exists — an unclaimed handle matching the business name is a squatting risk the buyer inherits. Naming the platforms you checked is what makes this repeatable between consultants and between deals.",
    severityGuidance:
      "Red where an account material to revenue is administered by someone outside the transaction, or credentials are held by a departing employee. Yellow where administration cannot be established, or accounts exist that the seller was unaware of. Green where every material account is under demonstrated seller control and agreed to transfer.",
    fieldSchema: SOCIAL_FIELDS,
    evidenceExpectation: EvidenceExpectation.NONE,
    blockingDependency: BlockingDependency.NONE,
  },
  "Trademark conflict scan on business name / domain": {
    description:
      "A search of the federal register, applicable state registers, and common-law use for marks conflicting with the business name or domain. A screening step, not a legal opinion.",
    guidance:
      "Manual and consultant-triggered. Search the federal register first (the USPTO's current public search interface replaced the retired TESS system), then the state register where the business operates, then plain web and directory searches for unregistered common-law use in the same trade. Record which registers you searched — an unstated scope is what makes this finding indefensible. Similarity only matters within the same class of goods or services: two identical marks in unrelated classes ordinarily coexist. This is screening for referral, not a clearance opinion; where anything is arguable, the finding is 'refer to trademark counsel', never 'this conflicts'.",
    severityGuidance:
      "Red if a registered mark of a third party is confusingly similar in the same class, or the business is trading under a name a third party has federally registered in its class. Yellow if similar marks exist in adjacent classes, if the seller holds no registration for a name material to the deal's value, or if common-law use by another business is evident. Green if nothing similar was found in the same class. Always state that this is a screening search and not a legal clearance.",
    fieldSchema: TRADEMARK_FIELDS,
    evidenceExpectation: EvidenceExpectation.NONE,
    blockingDependency: BlockingDependency.NONE,
  },

  // --- Tier B ---
  "Primary business-system contract terms, term length, early-termination penalty": {
    description:
      "Terms of the contract for the core operating system the business runs on: term, renewal, cost, transferability, and early-termination exposure.",
    guidance:
      "Obtain the executed agreement, not the vendor's public terms page, and read the assignment clause directly — the transferability answer is almost never in the summary the seller gives you. Record the cancellation notice as a deadline rather than a duration: a 90-day notice requirement on a term ending in 60 days has already closed, and that is the finding. Where the contract is silent on assignment, record 'unclear' and say so; silence is not consent.",
    severityGuidance:
      "Red where the contract does not transfer, or transfer requires a consent the vendor has no obligation to give, or the early-termination exposure is material against the deal value. Yellow where transfer requires consent that is routinely granted, where an auto-renewal deadline falls before the expected close, or where the terms could not be obtained. Green where it transfers with the business on its existing terms. Materiality is deal-dependent: a $5,000 penalty is noise against a $2M purchase price and a deal term against a $150k one — state the comparison in the note rather than applying a fixed threshold.",
    fieldSchema: PRIMARY_CONTRACT_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },
  "Payment processor account standing": {
    description:
      "The standing of the business's card-processing account: chargeback experience, reserves or holds, and account status.",
    guidance:
      "Ask for processor statements covering at least six months, not a summary and not a single clean month — the pattern is the finding. Read the chargeback ratio and count, any rolling reserve or hold, and whether the account is under review. Compute the ratio the way the card networks do: chargebacks as a share of transactions in the same period. Be explicit that a merchant account does not transfer: the buyer underwrites a new account in their own name, so the finding is about the risk profile and revenue continuity the buyer inherits, not about assigning a contract.",
    severityGuidance:
      "The card networks run excess-chargeback monitoring programmes with published entry thresholds — check the current Visa and Mastercard programme thresholds at the time of the audit and state the one you applied in the note, since these are revised periodically. Red if the account is in a network monitoring programme, terminated, under review, or carries a reserve material to working capital. Yellow if the ratio is trending toward a programme threshold, a reserve exists, or statements covering less than six months were provided. Green on a clean multi-month history with no reserve. Always record the exact period reviewed — a rating drawn from one month is not defensible.",
    fieldSchema: PAYMENT_PROCESSOR_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },
  "Recurring SaaS inventory": {
    description:
      "Every recurring software subscription the business depends on: cost, who it is billed to, and whether it transfers or must be rebuilt.",
    guidance:
      "Build this from the seller's list, then corroborate it against a card or bank statement — the tools that matter most are the ones the seller forgot, and the usual reason they were forgotten is that they are billed to the owner's personal card. Record that in the 'billed to' column when you find it: a subscription on a personal card stops working when the owner leaves, and nothing about the sale changes that automatically. 'Must-rebuild' is the column the buyer's first ninety days depend on.",
    severityGuidance:
      "Red where a tool material to operations must be rebuilt, or where the seller cannot produce a complete list. Yellow where several tools are billed to individuals rather than the business, or where transferability is unclear on anything material. Green on a complete list, billed to the business, transferring with it. Total monthly cost is a factor only where it is material against the deal's earnings.",
    fieldSchema: SAAS_INVENTORY_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },

  // --- Tier C ---
  "Live login to hosting/CMS admin": {
    description:
      "Verification, performed by the consultant, that administrative access to the hosting and content-management environment exists and can be handed over.",
    guidance:
      "Performed outside this system, in your own browser and your own session — this product never accepts or stores third-party credentials, and that is a deliberate decision, not a limitation to apologise for. Have the seller log in and demonstrate, or log in under supervision using credentials the seller enters. What you are testing is whether owner-level control can actually be handed over, not merely whether a login works: a login that reaches a limited-permission account is a different finding from one that reaches the account of record.",
    severityGuidance:
      "Red if no one in the transaction can produce administrative access, or access runs through a third party unwilling to release it. Yellow if access exists only at a limited permission level, is shared through a personal account, or the check could not be scheduled before the rating was needed. Green where owner-level access is demonstrated and transferable. Where the seller would not permit the check, record BLOCKED rather than rating it — an untested item must not read as a passed one.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
  },
  "Data-export test": {
    description:
      "A performed export of the business's own operating data, verifying that the buyer can obtain it in a usable form.",
    guidance:
      "Actually run the export; do not accept a description of it. The question is not whether an export button exists but whether what it produces is usable — scope and format are what decide that. A screen of records or a PDF is not portable data, and an export covering the last ninety days is not an export of five years of history. Name the record types you obtained: customers, transactions, and appointment or order history are usually the ones with value, and platforms commonly export one well and another badly.",
    severityGuidance:
      "Red where the data the business runs on cannot be exported in a structured form, or where the customer list specifically cannot be obtained. Yellow where the export is partial, covers a limited window, arrives in a format needing substantial rework, or could not be performed in time. Green where a structured export of the material record types was produced and inspected. State what you inspected — an export received but not opened is not a verified export.",
    fieldSchema: DATA_EXPORT_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
  },

  // --- Restaurant ---
  "Online-ordering platform contract and transferability clause": {
    description:
      "Terms of the online-ordering platform agreement: cost, take rate, transferability, and who owns the customer relationship.",
    guidance:
      "Read the assignment clause and the data-ownership clause together. On marketplace-style platforms the customer relationship frequently belongs to the platform rather than the merchant, which caps what the buyer is actually acquiring however the contract transfers. Record the commission or take rate — it is the term with the largest effect on the earnings the buyer is underwriting.",
    severityGuidance:
      "Red where the agreement does not transfer and online ordering is material to revenue, or where the platform owns the customer data outright. Yellow where transfer needs consent, where the take rate is materially above the market for the category, or where terms could not be obtained. Green where it transfers on existing terms with merchant-owned customer data.",
    fieldSchema: PLATFORM_CONTRACT_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },
  "POS-to-online-ordering integration health": {
    description:
      "Verification, performed live, that orders placed through the online channel reach the point-of-sale system correctly.",
    guidance:
      "Observe it end to end rather than accepting that an integration is configured: place or watch a test order through the customer-facing channel and follow it into the point-of-sale. Menu and price divergence between the two is the common failure and is usually invisible until someone looks. Record what you ordered and what arrived.",
    severityGuidance:
      "Red where orders do not reach the point-of-sale without manual re-entry, or where prices differ between channels in a way that loses money on every order. Yellow where the integration works but menus have drifted, or where it could not be observed live. Green where a test order flowed through correctly with matching prices.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
  },
  "Third-party delivery platform account ownership and menu sync": {
    description:
      "Verification of who administers the business's third-party delivery accounts, and whether menu and pricing are accurate on each.",
    guidance:
      "Check each delivery platform the business appears on, including any it does not know it appears on — platforms create unmanaged listings from public information, and those listings take orders the business cannot fulfil correctly. Confirm who holds the administrative account for each, and compare the live menu and prices against the in-house menu.",
    severityGuidance:
      "Red where a platform account material to revenue is controlled outside the transaction, or where an unmanaged listing is taking orders. Yellow where menus or prices have drifted, or where administration cannot be established. Green where every listing is administered by the seller, accurate, and agreed to transfer.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
  },

  // --- Salon ---
  "Booking software contract and client-data export terms": {
    description:
      "Terms of the booking platform agreement, including what client and appointment data the platform is contractually required to release.",
    guidance:
      "Record what the contract promises, and treat that as a claim to be verified rather than a finding in itself — the live export check tests what the platform actually produces. Where the two diverge, the divergence is the finding. For a service business the client list and appointment history are the asset being bought; a platform that will only release them as a PDF has effectively made them non-portable whatever the contract says.",
    severityGuidance:
      "Red where the contract does not transfer, or specifies no obligation to release client data in a usable form. Yellow where the promised export is limited in scope or format, where transfer needs consent, or where terms could not be obtained. Green where it transfers and a structured full-history export is contractually provided for.",
    fieldSchema: BOOKING_CONTRACT_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },
  "Recurring membership/package liability and transfer terms": {
    description:
      "Outstanding prepaid client balances and recurring memberships, and who carries the obligation for them after close.",
    guidance:
      "Quantify this rather than describing it. Prepaid packages are service already sold and not yet delivered, and they are frequently the largest liability in a service-business deal that appears nowhere in the financial statements. Get the outstanding balance and the count of active packages out of the booking system, and establish in writing whether the buyer honours them, the seller settles them at close, or they are refunded. Ask separately whether stored payment credentials transfer — they very often do not, which means every member has to re-enter card details and some never will.",
    severityGuidance:
      "Red where an outstanding prepaid balance material against the purchase price transfers to the buyer with no adjustment, or where the balance cannot be quantified from the system. Yellow where the amount is quantified but the treatment at close is unagreed, or where recurring billing will not carry over. Green where the balance is quantified and its treatment is documented in the purchase agreement. Materiality is a proportion of the deal, not a fixed figure — state the comparison you used.",
    fieldSchema: MEMBERSHIP_LIABILITY_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },

  // --- Franchise ---
  "Franchisor-mandated technology stack compliance": {
    description:
      "Which systems the franchise agreement requires, what they cost, whether the buyer may substitute alternatives, and what the franchisor requires to transfer them.",
    guidance:
      "Read the technology addendum and the transfer provisions together. The buyer's real question is how much of the operating cost base they cannot change: a mandated vendor at an above-market rate is a permanent margin constraint, not a switchable supplier. Establish separately whether the franchisor's consent is needed to transfer the systems and what fee attaches to it — a technology transfer fee is a closing cost that is routinely missed.",
    severityGuidance:
      "Red where the franchisor can withhold consent to the technology transfer, or where mandated costs are material against the location's earnings. Yellow where substitution is barred but costs are in line, where a transfer fee applies, or where the addendum could not be obtained. Green where mandated systems are at market rates and transfer is administrative.",
    fieldSchema: FRANCHISOR_STACK_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },
  "Franchise-system SSO and account transfer process": {
    description:
      "Verification of the actual mechanics of transferring franchise-system access and accounts to a new owner.",
    guidance:
      "Test the documented procedure against what the franchisor's systems actually do — the documented process and the real one diverge often enough that it is worth the call. Establish who at the franchisor executes the transfer, how long it takes, and whether the location loses access to its own operating systems in between. A gap of days between the seller's access ending and the buyer's beginning is an operational finding the buyer must plan around.",
    severityGuidance:
      "Red where access cannot be transferred without a service interruption the business cannot absorb, or where the franchisor will not commit to a process. Yellow where the process is manual, slow, or undocumented, or where it could not be verified before the rating was needed. Green where a defined process exists and the franchisor confirms it.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
  },

  // --- E-commerce ---
  "Platform account ownership and transfer mechanics": {
    description:
      "Verification of who holds owner-level access to the storefront platform, and what transferring ownership actually requires.",
    guidance:
      "Confirm the account of record, not merely that someone can log in. Platform ownership transfer is usually a defined procedure with its own requirements, and it frequently touches the billing relationship and any connected payment account at the same time. Establish what happens to those at transfer, because a storefront that transfers while its payment account does not is a storefront that cannot take money on day one.",
    severityGuidance:
      "Red where owner-level access sits outside the transaction, or the platform will not transfer the account. Yellow where transfer is possible but procedurally involved, where billing or payment connections need re-establishing, or where the check could not be performed. Green where owner access is demonstrated and the transfer procedure is confirmed.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
  },
  "Installed app/plugin inventory and licensing": {
    description:
      "An inventory, taken from the live platform, of installed paid applications and their licensing terms.",
    guidance:
      "Take this from the admin rather than from a document: what is installed today and what anyone believes is installed diverge routinely. Note licences tied to the seller's identity rather than the store, and any app the storefront's checkout or fulfilment actually depends on — a dependency on an app that does not transfer is a functional break at close, not a cost item.",
    severityGuidance:
      "Red where the storefront depends on an application that will not transfer, or a licence is tied to the seller personally with no replacement path. Yellow where paid applications carry per-seat licensing needing re-purchase, or the inventory could not be taken live. Green where the installed set is inventoried and transfers with the store.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
  },
  "Payment gateway PCI compliance scope": {
    description:
      "The business's card-data compliance scope: which self-assessment applies, whether a current attestation exists, and where liability sits.",
    guidance:
      "Establish which self-assessment questionnaire the merchant actually falls under, because the scope difference is the whole finding: where card data never touches the merchant's own systems the ongoing obligation is small, and where the merchant handles or stores card data it is substantial and continuing. Ask for the current attestation and check its date. Where the seller does not know which questionnaire applies, that is itself the finding.",
    severityGuidance:
      "Red where card data is handled or stored by merchant-controlled systems with no current attestation, or where the merchant's obligations are plainly unmet. Yellow where an attestation has lapsed, where the applicable scope cannot be established, or where the compliance obligation is broader than the buyer expects. Green where a current attestation is on file for a narrow scope. Record that this is a scoping review and not a compliance assessment.",
    fieldSchema: PCI_FIELDS,
    evidenceExpectation: EvidenceExpectation.DOCUMENT,
    blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  },
};

/**
 * v2 items this revision deliberately drops, with the reason.
 *
 * Dropping an item from a new version is a methodology decision, not a deletion — audits pinned to
 * v1/v2 keep the item and its recorded finding. Listed explicitly so `assertEnrichmentCoverage`
 * can tell "deliberately retired" apart from "forgotten".
 */
const RETIRED_ITEMS: Record<string, string> = {
  "Live login to POS/booking/GBP/socials":
    "Bundled four unrelated systems into one pass/fail with one severity. Under §6's roll-up rule " +
    "any single Red makes the whole tier Red, so a Red on a social account and a Red on the " +
    "point-of-sale were indistinguishable in the report. Split into two items below.",
};

// ---------------------------------------------------------------------------
// New items introduced in v3
// ---------------------------------------------------------------------------

/** Replaces the retired bundled Tier C item, for every template. */
const SPLIT_LIVE_ACCESS_ITEMS: TemplateItemInput[] = [
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Live login to the primary operating system",
    description:
      "Verification, performed by the consultant, that administrative access to the system the business runs on day to day can be demonstrated and handed over.",
    guidance:
      "The point-of-sale, booking, or equivalent system the business actually operates on. Performed outside this product, in your own session — no credentials are accepted or stored here. Test for owner-level control rather than the existence of a working login, and note where the account of record is a personal one.",
    severityGuidance:
      "Red where owner-level access cannot be produced by anyone in the transaction. Yellow where access is limited, shared, or held in a personal account, or where the check could not be scheduled. Green where owner-level access is demonstrated and transferable. Record BLOCKED, not a rating, where the seller would not permit the check.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
    sortOrder: 120,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Live login to listing and social accounts",
    description:
      "Verification that administrative access to the business's public listing and social accounts exists and can be transferred.",
    guidance:
      "Separated from the operating-system check because the severity means something different: losing the point-of-sale stops the business, while losing a listing erodes its demand over months. Confirm administrative access to each account established under the Tier A ownership item, and note any held by a departing employee or an outside agency.",
    severityGuidance:
      "Red where an account material to demand is controlled outside the transaction with no release agreed. Yellow where access is through a personal account, cannot be demonstrated for some accounts, or the check could not be performed. Green where administrative access to every material account is demonstrated.",
    fieldSchema: ATTESTATION_FIELDS,
    evidenceExpectation: EvidenceExpectation.ATTESTATION,
    blockingDependency: BlockingDependency.LIVE_ACCESS,
    sortOrder: 125,
  },
];

/**
 * docs/spec.md §4's base Tier B table lists platform-contract transferability as a universal item.
 * v1/v2 expressed it only as the restaurant's online-ordering contract and the salon's booking
 * contract, leaving franchise and e-commerce with no transferability item at all. These are the
 * vertical-appropriate instances for the two templates that lacked one.
 */
const FRANCHISE_PLATFORM_ITEM: TemplateItemInput = {
  tier: Tier.B,
  method: CheckMethod.MANUAL,
  title: "Customer-facing platform contract and transferability",
  description:
    "Terms of the agreement for the customer-facing ordering, booking, or loyalty platform this location operates, including whether it transfers to the buyer.",
  guidance:
    "Distinct from the franchisor technology mandate, which establishes what the location must use. This item establishes what the *contract* for it says about term, cost, and assignment — and who holds it, since a location-level agreement and a franchisor master agreement transfer very differently. Where the platform is contracted at the franchisor level, record that here: the buyer inherits terms they were never party to and cannot renegotiate.",
  severityGuidance:
    "Red where the agreement does not transfer and the platform is material to revenue. Yellow where transfer requires consent, where the contract sits at franchisor level on terms not disclosed to the buyer, or where terms could not be obtained. Green where it transfers on its existing terms.",
  fieldSchema: PLATFORM_CONTRACT_FIELDS,
  evidenceExpectation: EvidenceExpectation.DOCUMENT,
  blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  sortOrder: 205,
};

const ECOMMERCE_PLATFORM_ITEM: TemplateItemInput = {
  tier: Tier.B,
  method: CheckMethod.MANUAL,
  title: "Customer-facing platform contract and transferability",
  description:
    "Terms of the storefront platform agreement: plan, cost, term, transferability, and who owns the customer data.",
  guidance:
    "The Tier C item verifies the mechanics of moving the account; this one establishes what the buyer is contractually entitled to move. Read the data-ownership terms as carefully as the assignment clause — a storefront that transfers while its customer records do not is a shell. Record the plan and any annual commitment: storefront platforms commonly discount annual terms, which the buyer inherits along with the commitment.",
  severityGuidance:
    "Red where the agreement does not transfer, or the platform retains rights to customer data the buyer is paying for. Yellow where transfer requires consent or re-contracting, where an annual commitment carries a penalty, or where terms could not be obtained. Green where it transfers on existing terms with merchant-owned data.",
  fieldSchema: PLATFORM_CONTRACT_FIELDS,
  evidenceExpectation: EvidenceExpectation.DOCUMENT,
  blockingDependency: BlockingDependency.SELLER_DOCUMENTS,
  sortOrder: 215,
};

/** The salon template had no Tier C item at all — see the header comment. */
const SALON_LIVE_EXPORT_ITEM: TemplateItemInput = {
  tier: Tier.C,
  method: CheckMethod.MANUAL,
  title: "Live verification of client record count and booking-platform export",
  description:
    "A performed check of the client and appointment records held in the booking platform, and of the export the platform actually produces.",
  guidance:
    "The client list is the asset being bought in a service business, and the Tier B item records only what the platform is contractually obliged to release. Verify it: have the seller open the booking platform, record the count of active client records and the appointment history depth actually present, then run the export and open what comes out. Compare the count against what the seller represented, and the export's format and scope against what the contract promised. Any divergence between the three is the finding.",
  severityGuidance:
    "Red where the client records cannot be exported in a structured form, or where the count materially contradicts what the seller represented. Yellow where the export is limited in scope or format, where appointment history is shallower than represented, or where the check could not be performed. Green where the count matches, the export is structured, and it covers the history the contract promised.",
  fieldSchema: DATA_EXPORT_FIELDS,
  evidenceExpectation: EvidenceExpectation.ATTESTATION,
  blockingDependency: BlockingDependency.LIVE_ACCESS,
  sortOrder: 220,
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const V3_CHANGE_NOTE =
  "Structured capture on every document-backed and live-access item, replacing the single free-text " +
  "note; verification procedure and severity thresholds recorded on every manual item; the bundled " +
  "live-login item split into operating-system and listing/social checks; platform-transferability " +
  "added to the franchise and e-commerce templates; a live client-record and export check added to " +
  "the salon template.";

export { V3_CHANGE_NOTE };

/**
 * `Object.hasOwn`, not `in`. These registries are plain object literals, so `in` walks the prototype
 * chain: an item titled `constructor`, `toString` or `valueOf` tested true against RETIRED_ITEMS and
 * was SILENTLY DROPPED from the published template — no error and no coverage failure, because
 * dropping is exactly what enrich() does for a retired item. The consultant's checklist would simply
 * have been one item shorter than the one that was authored. `ENRICHMENTS[item.title]` had the
 * mirror of it, returning a function that would then be spread over the item.
 *
 * Titles are product-authored, so this needed an authoring accident to fire. Closed anyway: the cost
 * is one lookup, and "someone would have to name an item that" is the same argument that failed
 * three times in one day.
 */
function enrich(item: TemplateItemInput): TemplateItemInput | null {
  if (Object.hasOwn(RETIRED_ITEMS, item.title)) return null;
  const enrichment = Object.hasOwn(ENRICHMENTS, item.title) ? ENRICHMENTS[item.title] : undefined;
  return enrichment ? { ...item, ...enrichment } : item;
}

/**
 * Fails the build if a v2 item is neither enriched nor deliberately retired.
 *
 * Without this, adding a checklist item and forgetting to decide its guidance and severity
 * thresholds produces an item that looks finished and silently carries none of the depth this
 * version exists to add — which is exactly how v2's five unstructured Tier B items happened.
 */
export function assertEnrichmentCoverage() {
  const allV2Titles = [
    ...BASE_TEMPLATE_ITEMS,
    ...TIER_A_EXPANSION_ITEMS,
    ...RESTAURANT_SPECIFIC_ITEMS,
    ...SALON_SPECIFIC_ITEMS,
    ...FRANCHISE_SPECIFIC_ITEMS,
    ...ECOMMERCE_SPECIFIC_ITEMS,
  ].map((item) => item.title);

  const missing = [...new Set(allV2Titles)].filter(
    (title) => !Object.hasOwn(ENRICHMENTS, title) && !Object.hasOwn(RETIRED_ITEMS, title),
  );
  if (missing.length > 0) {
    throw new Error(
      `Template v3 has no guidance for: ${missing.join("; ")}. Add an entry to ENRICHMENTS or ` +
        "record it in RETIRED_ITEMS with a reason.",
    );
  }
}

const EXTRA_ITEMS_BY_SLUG: Record<string, TemplateItemInput[]> = {
  "restaurant-online-ordering": [],
  "salon-booking": [SALON_LIVE_EXPORT_ITEM],
  "franchise-location": [FRANCHISE_PLATFORM_ITEM],
  "general-ecommerce": [ECOMMERCE_PLATFORM_ITEM],
};

/** Builds the full v3 item set for one template slug. */
export function buildEvidenceDepthItems(
  slug: string,
  specificItems: TemplateItemInput[],
): TemplateItemInput[] {
  assertEnrichmentCoverage();

  const carried = [...BASE_TEMPLATE_ITEMS, ...TIER_A_EXPANSION_ITEMS, ...specificItems]
    .map(enrich)
    .filter((item): item is TemplateItemInput => item !== null);

  const items = [...carried, ...SPLIT_LIVE_ACCESS_ITEMS, ...(EXTRA_ITEMS_BY_SLUG[slug] ?? [])];
  return items.sort((a, b) => a.sortOrder - b.sortOrder);
}
