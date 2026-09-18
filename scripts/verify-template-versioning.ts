/**
 * One-off verification script (not part of the app) for template versioning (docs/spec.md §5,
 * src/lib/templates/publish.ts). Confirms:
 *  1. Publishing a new version deactivates the old one and activates the new one.
 *  2. An Audit created against v1 keeps pointing at the v1 Template row after v2 is published —
 *     it is never silently moved onto the new version.
 *  3. A new Audit created after publishing resolves to v2, not v1.
 * Run with: npx tsx scripts/verify-template-versioning.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Tier, CheckMethod, FindingStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withOrgScope } from "@/lib/db/scoped";
import { publishTemplateVersion } from "@/lib/templates/publish";

// closecheck_app (the shared `prisma` client's role) only has SELECT on templates/template_items
// (prisma/migrations/20260911160500_least_privilege_app_role) — template writes are deliberately
// restricted to the direct/migration role, same reasoning as prisma/seed.ts using
// DIRECT_DATABASE_URL instead of the app client.
const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const SLUG = `verify-versioning-test-${randomUUID().slice(0, 8)}`;

// Mirrors the active-template lookup in src/lib/actions/audits.ts's createAudit exactly, so this
// script exercises the same resolution path the real Server Action uses.
async function createAuditPinnedToActiveTemplate(orgId: string, engagementId: string) {
  const template = await prisma.template.findFirst({ where: { slug: SLUG, isActive: true }, include: { items: true } });
  if (!template) throw new Error(`No active template found for slug "${SLUG}"`);
  return withOrgScope(orgId, (tx) =>
    tx.audit.create({
      data: {
        orgId,
        engagementId,
        templateId: template.id,
        findings: {
          create: template.items.map((item) => ({
            orgId,
            templateItemId: item.id,
            status: FindingStatus.NOT_STARTED,
          })),
        },
      },
    }),
  );
}

async function main() {
  const orgId = randomUUID();
  await withOrgScope(orgId, (tx) => tx.consultantOrg.create({ data: { id: orgId, name: "Versioning Test Org" } }));
  const engagement = await withOrgScope(orgId, (tx) =>
    tx.engagement.create({ data: { orgId, businessName: "Versioning Test Deal" } }),
  );

  const v1 = await publishTemplateVersion(directPrisma, {
    slug: SLUG,
    name: "Versioning Test Template",
    description: "v1",
    items: [
      { tier: Tier.A, method: CheckMethod.MANUAL, title: "Item A", description: "v1 item", sortOrder: 10 },
    ],
  });
  console.log(`Published v${v1.version} (active: ${v1.isActive})`);

  const auditOnV1 = await createAuditPinnedToActiveTemplate(orgId, engagement.id);

  const v2 = await publishTemplateVersion(directPrisma, {
    slug: SLUG,
    name: "Versioning Test Template",
    description: "v2 — Item A renamed",
    items: [
      { tier: Tier.A, method: CheckMethod.MANUAL, title: "Item A (revised)", description: "v2 item", sortOrder: 10 },
    ],
  });
  console.log(`Published v${v2.version} (active: ${v2.isActive})`);

  const v1Reloaded = await prisma.template.findUniqueOrThrow({ where: { id: v1.id } });
  const auditOnV1Reloaded = await withOrgScope(orgId, (tx) => tx.audit.findUniqueOrThrow({ where: { id: auditOnV1.id } }));
  const auditOnV2 = await createAuditPinnedToActiveTemplate(orgId, engagement.id);

  const checks = [
    ["old version deactivated on publish", v1Reloaded.isActive === false],
    ["new version active on publish", v2.isActive === true],
    ["new version number incremented", v2.version === v1.version + 1],
    ["pre-existing audit still pinned to v1 row", auditOnV1Reloaded.templateId === v1.id],
    ["new audit resolves to v2 row", auditOnV2.templateId === v2.id],
  ] as const;

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "PASS" : "FAIL"}: ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "PASS: template versioning holds — publishing never moves an in-progress audit." : "FAIL");
  if (!ok) process.exitCode = 1;

  // Cleanup: cascades handle findings/audits/engagement via consultant_orgs' onDelete: Cascade;
  // templates aren't RLS-scoped or org-owned, so delete them directly.
  await withOrgScope(orgId, (tx) => tx.consultantOrg.delete({ where: { id: orgId } }));
  await directPrisma.template.deleteMany({ where: { slug: SLUG } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([prisma.$disconnect(), directPrisma.$disconnect()]));
