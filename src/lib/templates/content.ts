import { Tier, CheckMethod } from "@prisma/client";
import type { TemplateItemInput } from "./publish";

/**
 * The single source of template checklist content, shared by prisma/seed.ts (which creates each
 * slug's v1) and scripts/publish-tierA-expansion.ts (which publishes later versions). Moved here
 * from prisma/seed.ts so version publishing and seeding cannot drift apart. This is the product's
 * core IP, not routine seed data — see .claude/skills/audit-methodology/SKILL.md before changing
 * any of it, and docs/spec.md §4–5 for what each item is.
 *
 * Versioning discipline (docs/spec.md §5): BASE_TEMPLATE_ITEMS is v1 content and must not change —
 * additions belong in a new expansion array published as a new template version, the way
 * TIER_A_EXPANSION_ITEMS is.
 */

// Shared across every business-type Template (docs/spec.md §5's "beyond the base checklist" framing
// implies exactly this: these items apply regardless of vertical). Tier classification follows the
// definitions in docs/spec.md §4 exactly. sortOrder leaves gaps (10, 20, 30...) so each template's
// business-type-specific items can slot in at 200+ without renumbering the shared base every time a
// template is added.
export const BASE_TEMPLATE_ITEMS: TemplateItemInput[] = [
  // Tier A — external, no seller cooperation needed
  {
    tier: Tier.A,
    method: CheckMethod.AUTOMATED,
    title: "Domain and registrar ownership, expiration",
    description: "WHOIS lookup: registrar, registrant org, expiry date.",
    automationKey: "domain_whois",
    sortOrder: 10,
  },
  {
    tier: Tier.A,
    method: CheckMethod.AUTOMATED,
    title: "DNS provider and hosting fingerprint",
    description: "Nameservers, A records, and a best-effort guess at the hosting/DNS provider.",
    automationKey: "dns_hosting_fingerprint",
    sortOrder: 20,
  },
  {
    tier: Tier.A,
    method: CheckMethod.AUTOMATED,
    title: "SSL/TLS certificate validity, issuer, expiration",
    description: "Live TLS handshake against the primary domain.",
    automationKey: "ssl_cert",
    sortOrder: 30,
  },
  {
    tier: Tier.A,
    method: CheckMethod.AUTOMATED,
    title: "CMS identification and version/patch status",
    description: "Best-effort platform fingerprint from the public homepage. Does not assert vulnerability status from a version string alone.",
    automationKey: "cms_fingerprint",
    sortOrder: 40,
  },
  {
    tier: Tier.A,
    method: CheckMethod.MANUAL,
    title: "Google Business Profile ownership and claim status",
    description: "No reliable public API for claim status — check manually.",
    sortOrder: 50,
  },
  {
    tier: Tier.A,
    method: CheckMethod.MANUAL,
    title: "Social account ownership",
    description: "Which accounts exist, who administers them per public info.",
    sortOrder: 60,
  },
  {
    tier: Tier.A,
    method: CheckMethod.MANUAL,
    title: "Trademark conflict scan on business name / domain",
    description: "Consultant-triggered search, not automated (spec.md §12 open question).",
    sortOrder: 70,
  },
  // Tier B — seller/broker-provided documents
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Primary business-system contract terms, term length, early-termination penalty",
    description: "Upload the contract (POS, booking, or equivalent core platform); record term length and penalty amount/basis.",
    sortOrder: 80,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Payment processor account standing",
    description: "Chargebacks, holds, reserve — from seller-provided statements.",
    sortOrder: 90,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Recurring SaaS inventory",
    description: "What tools, what each costs, transfers vs. must-rebuild.",
    sortOrder: 100,
  },
  // Tier C — live access verification
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Live login to hosting/CMS admin",
    description: "Consultant-attested: performed outside the product (spec.md §4 — no credential handling in v1).",
    sortOrder: 110,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Live login to POS/booking/GBP/socials",
    description: "Consultant-attested, same pattern as above.",
    sortOrder: 120,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Data-export test",
    description: "Can the buyer actually get their data out? Consultant-attested.",
    sortOrder: 130,
  },
];

// Phase 4 Tier A expansion (docs/spec.md §13.1, added to §4's table 2026-09-21). Universal items —
// every business type has a domain and email — so they extend the base, not any one template.
// Published as a NEW version of each template via scripts/publish-tierA-expansion.ts, never folded
// into v1 (docs/spec.md §5 versioning). sortOrder slots them after cms_fingerprint (40), before the
// manual Tier A items (50+).
export const TIER_A_EXPANSION_ITEMS: TemplateItemInput[] = [
  {
    tier: Tier.A,
    method: CheckMethod.AUTOMATED,
    title: "Email authentication posture (SPF / DMARC; DKIM best-effort)",
    description:
      "SPF and DMARC DNS records for the business domain. DKIM is probed at common selectors only — a not-found DKIM result is not evidence of absence and never affects severity (spec.md §4's DKIM note).",
    automationKey: "email_auth_posture",
    sortOrder: 42,
  },
  {
    tier: Tier.A,
    method: CheckMethod.AUTOMATED,
    title: "Mail provider fingerprint",
    description: "MX records — who hosts the business's email, and a best-effort provider guess. A transfer-complexity signal, same class as the DNS/hosting fingerprint.",
    automationKey: "mail_provider_fingerprint",
    sortOrder: 44,
  },
  {
    tier: Tier.A,
    method: CheckMethod.AUTOMATED,
    title: "HTTPS hygiene",
    description: "Whether HTTP redirects to HTTPS, and whether an HSTS header is present. Observation only — a missing redirect is flagged for review, not asserted as a vulnerability.",
    automationKey: "https_hygiene",
    sortOrder: 46,
  },
];

// Restaurant/online-ordering — the one fully-built template for MVP per docs/spec.md §5 and
// docs/roadmap.md Phase 1. "Online-ordering platform" is a software layer specific to this template
// (not every business type has one), so its contract item lives here, not in the base list above.
export const RESTAURANT_SPECIFIC_ITEMS: TemplateItemInput[] = [
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Online-ordering platform contract and transferability clause",
    description: "Upload the contract; record whether it transfers to a new owner or must be rebuilt.",
    sortOrder: 200,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "POS-to-online-ordering integration health",
    description: "Restaurant-specific (spec.md §5): observed live, not just contractually described.",
    sortOrder: 210,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Third-party delivery platform account ownership and menu sync",
    description: "Restaurant-specific (spec.md §5): DoorDash/UberEats-style account admin access and menu sync accuracy.",
    sortOrder: 220,
  },
];

// Salon/service business with booking (docs/spec.md §5, docs/roadmap.md Phase 2). Built ahead of
// design-partner deal-flow evidence per explicit user direction overriding the usual
// evidence-sequencing guardrail (.claude/skills/audit-methodology/SKILL.md) — flagged here rather than
// silently treated as validated content.
export const SALON_SPECIFIC_ITEMS: TemplateItemInput[] = [
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Booking software contract and client-data export terms",
    description: "Upload the contract; record what client/appointment data format the platform is contractually required to export, and any lock-in penalty.",
    sortOrder: 200,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Recurring membership/package liability and transfer terms",
    description: "Upload membership/package agreements; record whether prepaid client balances and recurring billing transfer to a new owner or must be honored/refunded by the seller.",
    sortOrder: 210,
  },
];

// Franchise location, any vertical (docs/spec.md §5, docs/roadmap.md Phase 2). Same evidence caveat
// as Salon above — built ahead of validated deal-flow sequencing per explicit user direction.
export const FRANCHISE_SPECIFIC_ITEMS: TemplateItemInput[] = [
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Franchisor-mandated technology stack compliance",
    description: "Upload the franchise agreement's technology addendum; record which systems (POS, booking, marketing) are franchisor-mandated and whether the buyer can substitute a different vendor post-close.",
    sortOrder: 200,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Franchise-system SSO and account transfer process",
    description: "Consultant-attested: verify the actual mechanics of transferring franchise-system single-sign-on access and accounts to a new owner, not just the documented procedure.",
    sortOrder: 210,
  },
];

// General e-commerce (docs/spec.md §5, docs/roadmap.md Phase 2 — "if still evidenced by then"; built
// now per explicit user direction ahead of that evidence, same caveat as Salon/Franchise above).
export const ECOMMERCE_SPECIFIC_ITEMS: TemplateItemInput[] = [
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Platform account ownership and transfer mechanics",
    description: "Consultant-attested: live verification of who holds primary/owner access on the platform (Shopify/WooCommerce/etc.) and what the actual transfer-of-ownership process requires.",
    sortOrder: 200,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Installed app/plugin inventory and licensing",
    description: "Consultant-attested: log into the platform admin to inventory installed paid apps/plugins and their per-seat or per-store licensing terms — a document alone won't reflect what's actually installed today.",
    sortOrder: 210,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Payment gateway PCI compliance scope",
    description: "Upload the payment gateway's compliance documentation; record PCI compliance level and where liability sits.",
    sortOrder: 220,
  },
];

export const TEMPLATE_DEFINITIONS: Array<{
  slug: string;
  name: string;
  description: string;
  specificItems: TemplateItemInput[];
}> = [
  {
    slug: "restaurant-online-ordering",
    name: "Restaurant with online ordering",
    description: "The one fully-built MVP template — see docs/spec.md §5 and docs/roadmap.md Phase 1.",
    specificItems: RESTAURANT_SPECIFIC_ITEMS,
  },
  {
    slug: "salon-booking",
    name: "Salon/service business with booking",
    description:
      "Phase 2 template (docs/spec.md §5) — built ahead of design-partner deal-flow evidence per explicit user direction; treat as unvalidated content until a real engagement exercises it.",
    specificItems: SALON_SPECIFIC_ITEMS,
  },
  {
    slug: "franchise-location",
    name: "Franchise location (any vertical)",
    description:
      "Phase 2 template (docs/spec.md §5) — built ahead of design-partner deal-flow evidence per explicit user direction; treat as unvalidated content until a real engagement exercises it.",
    specificItems: FRANCHISE_SPECIFIC_ITEMS,
  },
  {
    slug: "general-ecommerce",
    name: "General e-commerce",
    description:
      "Phase 2 template (docs/spec.md §5) — built ahead of design-partner deal-flow evidence per explicit user direction; treat as unvalidated content until a real engagement exercises it.",
    specificItems: ECOMMERCE_SPECIFIC_ITEMS,
  },
];
