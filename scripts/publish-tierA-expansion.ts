/**
 * Publishes the Phase 4 Tier A expansion (docs/spec.md §13.1: email_auth_posture,
 * mail_provider_fingerprint, https_hygiene) as a NEW version of each shipped template, per the
 * versioning rules in docs/spec.md §5 and the release event recorded in docs/releases.md §3 —
 * in-progress Audits stay pinned to the version they started on; only new Audits see these items.
 *
 * Idempotent per slug: skips any template whose active version already contains all three new
 * automation keys, so re-running (e.g. in a deploy hook) publishes nothing extra.
 *
 * Run with: npm run db:publish-tiera-expansion
 */
import { PrismaClient } from "@prisma/client";
import { publishTemplateVersion } from "@/lib/templates/publish";
import { BASE_TEMPLATE_ITEMS, TIER_A_EXPANSION_ITEMS, TEMPLATE_DEFINITIONS } from "@/lib/templates/content";

// Template writes are restricted to the direct/migration role — closecheck_app only has SELECT on
// templates/template_items (prisma/migrations/20260911160500_least_privilege_app_role), same
// reasoning as prisma/seed.ts.
const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const EXPANSION_KEYS = TIER_A_EXPANSION_ITEMS.map((item) => item.automationKey as string);

async function main() {
  for (const def of TEMPLATE_DEFINITIONS) {
    const active = await directPrisma.template.findFirst({
      where: { slug: def.slug, isActive: true },
      include: { items: { select: { automationKey: true } } },
    });
    if (!active) {
      console.log(`SKIP ${def.slug}: no active version found — run db:seed first.`);
      continue;
    }

    const presentKeys = new Set(active.items.map((i) => i.automationKey).filter(Boolean));
    if (EXPANSION_KEYS.every((key) => presentKeys.has(key))) {
      console.log(`SKIP ${def.slug}: active v${active.version} already has the Tier A expansion.`);
      continue;
    }

    const published = await publishTemplateVersion(directPrisma, {
      slug: def.slug,
      name: def.name,
      description: def.description,
      items: [...BASE_TEMPLATE_ITEMS, ...TIER_A_EXPANSION_ITEMS, ...def.specificItems],
    });
    console.log(
      `Published "${published.name}" v${published.version} (${published.items.length} items, was v${active.version}).`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await directPrisma.$disconnect();
  });
