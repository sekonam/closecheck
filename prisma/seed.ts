import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { BASE_TEMPLATE_ITEMS, TEMPLATE_DEFINITIONS } from "@/lib/templates/content";

// Deliberately connects with DIRECT_DATABASE_URL (the superuser/migration role), not the app's
// `closecheck_app` role: creating the dev org's first row is the same kind of bootstrap write
// migrations do, and RLS blocks it under `closecheck_app` by design — there is no
// `app.current_org_id` to scope by until this org exists (see the `unscoped()` docstring in
// src/lib/db/scoped.ts and scripts/purge-expired-documents.ts for the same pattern).
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

// Checklist content lives in src/lib/templates/content.ts (shared with the version-publishing
// scripts so seed and publish can't drift). This seed creates each slug's v1 ONLY — the Tier A
// expansion (docs/spec.md §13.1) ships as v2 via scripts/publish-tierA-expansion.ts, never folded
// into v1 (docs/spec.md §5 versioning: existing deployments already have Audits pinned to v1 as
// seeded; changing v1's content here would make a fresh install's v1 disagree with theirs).
async function main() {
  for (const def of TEMPLATE_DEFINITIONS) {
    const items = [...BASE_TEMPLATE_ITEMS, ...def.specificItems];
    const template = await prisma.template.upsert({
      where: { slug_version: { slug: def.slug, version: 1 } },
      update: {},
      create: {
        slug: def.slug,
        version: 1,
        name: def.name,
        description: def.description,
        isActive: true,
        items: { create: items },
      },
    });
    console.log(`Seeded template "${template.name}" v${template.version} with ${items.length} items.`);
  }

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
