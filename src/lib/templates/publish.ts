import type { PrismaClient, Tier, CheckMethod } from "@prisma/client";

export type TemplateItemInput = {
  tier: Tier;
  method: CheckMethod;
  title: string;
  description: string;
  automationKey?: string;
  sortOrder: number;
};

/**
 * Publishes a new version of a template (docs/spec.md §5): deactivates the current active version
 * for the slug, if one exists, and creates a new Template row one version higher, active
 * immediately. Deliberately does NOT touch any existing Audit — Audit.templateId is a foreign key
 * to a specific Template row, not a slug+version lookup, so every in-progress Audit keeps pointing
 * at the exact row it was created against. Only new Audits (src/lib/actions/audits.ts's
 * `{slug, isActive: true}` lookup) ever see the new version.
 *
 * Templates are shared, non-tenant content — not RLS-scoped — so this runs against the plain
 * client, same as the read in createAudit.
 */
export async function publishTemplateVersion(
  prisma: PrismaClient,
  params: { slug: string; name: string; description: string; items: TemplateItemInput[] },
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.template.findFirst({ where: { slug: params.slug, isActive: true } });
    if (current) {
      await tx.template.update({ where: { id: current.id }, data: { isActive: false } });
    }
    const nextVersion = (current?.version ?? 0) + 1;
    return tx.template.create({
      data: {
        slug: params.slug,
        version: nextVersion,
        name: params.name,
        description: params.description,
        isActive: true,
        items: { create: params.items },
      },
      include: { items: true },
    });
  });
}
