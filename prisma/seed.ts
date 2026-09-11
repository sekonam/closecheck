import { PrismaClient, Tier, CheckMethod } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// The Restaurant/online-ordering Template — the one fully-built template for MVP per
// docs/spec.md §5 and docs/roadmap.md Phase 1. Base items (universal across templates) come first,
// then the restaurant-specific additions. Tier classification follows the definitions in
// docs/spec.md §4 exactly — see .claude/skills/audit-methodology/SKILL.md before changing any of
// this: it's the product's core IP, not routine seed data.
const RESTAURANT_TEMPLATE_ITEMS: Array<{
  tier: Tier;
  method: CheckMethod;
  title: string;
  description: string;
  automationKey?: string;
  sortOrder: number;
}> = [
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
    title: "POS system contract terms, term length, early-termination penalty",
    description: "Upload the contract; record term length and penalty amount/basis.",
    sortOrder: 80,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Online-ordering platform contract and transferability clause",
    description: "Upload the contract; record whether it transfers to a new owner or must be rebuilt.",
    sortOrder: 90,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Payment processor account standing",
    description: "Chargebacks, holds, reserve — from seller-provided statements.",
    sortOrder: 100,
  },
  {
    tier: Tier.B,
    method: CheckMethod.MANUAL,
    title: "Recurring SaaS inventory",
    description: "What tools, what each costs, transfers vs. must-rebuild.",
    sortOrder: 110,
  },
  // Tier C — live access verification
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Live login to hosting/CMS admin",
    description: "Consultant-attested: performed outside the product (spec.md §4 — no credential handling in v1).",
    sortOrder: 120,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Live login to POS/booking/GBP/socials",
    description: "Consultant-attested, same pattern as above.",
    sortOrder: 130,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Data-export test",
    description: "Can the buyer actually get their data out? Consultant-attested.",
    sortOrder: 140,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "POS-to-online-ordering integration health",
    description: "Restaurant-specific (spec.md §5): observed live, not just contractually described.",
    sortOrder: 150,
  },
  {
    tier: Tier.C,
    method: CheckMethod.MANUAL,
    title: "Third-party delivery platform account ownership and menu sync",
    description: "Restaurant-specific (spec.md §5): DoorDash/UberEats-style account admin access and menu sync accuracy.",
    sortOrder: 160,
  },
];

async function main() {
  const template = await prisma.template.upsert({
    where: { slug_version: { slug: "restaurant-online-ordering", version: 1 } },
    update: {},
    create: {
      slug: "restaurant-online-ordering",
      version: 1,
      name: "Restaurant with online ordering",
      description: "The one fully-built MVP template — see docs/spec.md §5 and docs/roadmap.md Phase 1.",
      isActive: true,
      items: { create: RESTAURANT_TEMPLATE_ITEMS },
    },
  });
  console.log(`Seeded template "${template.name}" v${template.version} with ${RESTAURANT_TEMPLATE_ITEMS.length} items.`);

  // Local dev login only — not a design-partner account. See README for credentials.
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
