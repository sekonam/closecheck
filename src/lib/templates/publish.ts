import type {
  PrismaClient,
  Tier,
  CheckMethod,
  BlockingDependency,
  EvidenceExpectation,
  Prisma,
} from "@prisma/client";

import { assertValidFieldSchema, type ItemFieldSchema } from "./fieldSchema";

export type TemplateItemInput = {
  tier: Tier;
  method: CheckMethod;
  title: string;
  /**
   * CLIENT-FACING — rendered verbatim into the whitelabeled PDF a consultant hands to a buyer.
   * Keep it in the consultant's professional register; internal notes go in `guidance`.
   */
  description: string;
  /** INTERNAL — how to actually perform the check. Never leaves the app. */
  guidance?: string;
  /** INTERNAL — when this item is Red vs Yellow vs Green, with the threshold's source. */
  severityGuidance?: string;
  fieldSchema?: ItemFieldSchema;
  evidenceExpectation?: EvidenceExpectation;
  blockingDependency?: BlockingDependency;
  automationKey?: string;
  sortOrder: number;
};

/**
 * Checks the invariants template content has to satisfy before it can become a published version.
 *
 * These are authoring-time mistakes, not user input, so this throws loudly rather than degrading:
 * a publish script failing is cheap, a malformed template row reaching a consultant mid-engagement
 * is not.
 */
export function assertPublishableItems(items: TemplateItemInput[], slug: string) {
  const seenTitles = new Set<string>();
  const seenSortOrders = new Set<number>();

  for (const item of items) {
    if (seenTitles.has(item.title)) {
      throw new Error(`Template "${slug}" has two items titled "${item.title}".`);
    }
    seenTitles.add(item.title);

    if (seenSortOrders.has(item.sortOrder)) {
      throw new Error(`Template "${slug}" has two items at sortOrder ${item.sortOrder}.`);
    }
    seenSortOrders.add(item.sortOrder);

    if (item.fieldSchema) {
      assertValidFieldSchema(item.fieldSchema, `"${slug}" / "${item.title}"`);
      // structuredData doubles as the Tier A automated runner's output store. An AUTOMATED item
      // that also declared capture fields would put a form and a check runner on the same column,
      // and whichever wrote last would erase the other. updateFinding enforces the same rule at
      // runtime; this is the authoring-time half so the mistake never reaches a row.
      if (item.method === "AUTOMATED") {
        throw new Error(
          `Template "${slug}" item "${item.title}" is AUTOMATED and cannot declare a fieldSchema — ` +
            "structuredData on automated items holds check output.",
        );
      }
    }
  }
}

/**
 * Asserts that no item's client-facing `description` leaks a product-internal reference.
 *
 * `description` renders verbatim into the whitelabeled PDF a consultant hands to a buyer, so a
 * string like "Restaurant-specific (spec.md §5)" puts this product's internal cross-references
 * into someone else's client deliverable. Internal methodology belongs in `guidance`.
 *
 * Deliberately NOT part of `assertPublishableItems`, which every publish runs. The v1 and v2
 * content arrays are frozen by the versioning discipline in content.ts — they carry exactly this
 * defect and cannot be edited, because a published version's text is what already-recorded
 * findings were rated against. Making the shared guard reject them would break a fresh install's
 * seed → v2 publish chain to fix text that, by the same discipline, must stay as it is. So this is
 * called by content authored from here on, which is where it can actually be satisfied.
 */
export function assertClientFacingDescriptions(items: TemplateItemInput[], slug: string) {
  for (const item of items) {
    if (/spec\.md|closecheck|docs\//i.test(item.description)) {
      throw new Error(
        `Template "${slug}" item "${item.title}" has a product-internal reference in its ` +
          "client-facing description. Move it to `guidance`.",
      );
    }
  }
}

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
  params: {
    slug: string;
    name: string;
    description: string;
    items: TemplateItemInput[];
    /** What changed relative to the previous version, in the consultant's language. */
    changeNote?: string;
  },
) {
  assertPublishableItems(params.items, params.slug);
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
        changeNote: params.changeNote ?? null,
        items: {
          create: params.items.map((item) => ({
            ...item,
            fieldSchema: (item.fieldSchema ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        },
      },
      include: { items: true },
    });
  });
}
