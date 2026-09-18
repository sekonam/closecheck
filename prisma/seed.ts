import { PrismaClient, Tier, CheckMethod } from "@prisma/client";
import bcrypt from "bcryptjs";

// Deliberately connects with DIRECT_DATABASE_URL (the superuser/migration role), not the app's
// `closecheck_app` role: creating the dev org's first row is the same kind of bootstrap write
// migrations do, and RLS blocks it under `closecheck_app` by design — there is no
// `app.current_org_id` to scope by until this org exists (see the `unscoped()` docstring in
// src/lib/db/scoped.ts and scripts/purge-expired-documents.ts for the same pattern).
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

type TemplateItemSeed = {
  tier: Tier;
  method: CheckMethod;
  title: string;
  description: string;
  automationKey?: string;
  sortOrder: number;
};

// Shared across every business-type Template (docs/spec.md §5's "beyond the base checklist" framing
// implies exactly this: these items apply regardless of vertical). Tier classification follows the
// definitions in docs/spec.md §4 exactly — see .claude/skills/audit-methodology/SKILL.md before
// changing any of this: it's the product's core IP, not routine seed data. sortOrder leaves gaps
// (10, 20, 30...) so each template's business-type-specific items can slot in at 200+ without
// renumbering the shared base every time a template is added.
const BASE_TEMPLATE_ITEMS: TemplateItemSeed[] = [
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

// Restaurant/online-ordering — the one fully-built template for MVP per docs/spec.md §5 and
// docs/roadmap.md Phase 1. "Online-ordering platform" is a software layer specific to this template
// (not every business type has one), so its contract item lives here, not in the base list above.
const RESTAURANT_SPECIFIC_ITEMS: TemplateItemSeed[] = [
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
const SALON_SPECIFIC_ITEMS: TemplateItemSeed[] = [
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
const FRANCHISE_SPECIFIC_ITEMS: TemplateItemSeed[] = [
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
const ECOMMERCE_SPECIFIC_ITEMS: TemplateItemSeed[] = [
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

async function seedTemplate(slug: string, name: string, description: string, specificItems: TemplateItemSeed[]) {
  const items = [...BASE_TEMPLATE_ITEMS, ...specificItems];
  const template = await prisma.template.upsert({
    where: { slug_version: { slug, version: 1 } },
    update: {},
    create: { slug, version: 1, name, description, isActive: true, items: { create: items } },
  });
  console.log(`Seeded template "${template.name}" v${template.version} with ${items.length} items.`);
}

async function main() {
  await seedTemplate(
    "restaurant-online-ordering",
    "Restaurant with online ordering",
    "The one fully-built MVP template — see docs/spec.md §5 and docs/roadmap.md Phase 1.",
    RESTAURANT_SPECIFIC_ITEMS,
  );
  await seedTemplate(
    "salon-booking",
    "Salon/service business with booking",
    "Phase 2 template (docs/spec.md §5) — built ahead of design-partner deal-flow evidence per explicit user direction; treat as unvalidated content until a real engagement exercises it.",
    SALON_SPECIFIC_ITEMS,
  );
  await seedTemplate(
    "franchise-location",
    "Franchise location (any vertical)",
    "Phase 2 template (docs/spec.md §5) — built ahead of design-partner deal-flow evidence per explicit user direction; treat as unvalidated content until a real engagement exercises it.",
    FRANCHISE_SPECIFIC_ITEMS,
  );
  await seedTemplate(
    "general-ecommerce",
    "General e-commerce",
    "Phase 2 template (docs/spec.md §5) — built ahead of design-partner deal-flow evidence per explicit user direction; treat as unvalidated content until a real engagement exercises it.",
    ECOMMERCE_SPECIFIC_ITEMS,
  );

  // Local dev login only — not a design-partner account, and never seeded in production, where a
  // publicly-known email/password (see README) would be a real, standing credential to guess.
  // Production accounts come from /signup (src/app/signup/page.tsx) instead.
  if (process.env.NODE_ENV === "production") {
    console.log("NODE_ENV=production: skipping dev login seed. Use /signup to create a real account.");
    return;
  }

  const devOrg = await prisma.consultantOrg.upsert({
    where: { id: "dev-org" },
    update: {},
    create: { id: "dev-org", name: "Dev Consulting LLC", brandColorHex: "#0f172a" },
  });

  const passwordHash = await bcrypt.hash("devpassword123", 10);
  await prisma.user.upsert({
    where: { email: "dev@closecheck.local" },
    update: {},
    create: {
      orgId: devOrg.id,
      email: "dev@closecheck.local",
      passwordHash,
      name: "Dev Consultant",
      role: "OWNER",
    },
  });
  console.log("Seeded dev login: dev@closecheck.local / devpassword123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
