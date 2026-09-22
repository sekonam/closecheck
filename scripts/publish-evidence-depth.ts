/**
 * Publishes template v3 — "evidence depth" (src/lib/templates/evidenceDepth.ts).
 *
 * Run after `prisma/seed.ts` (v1) and `scripts/publish-tierA-expansion.ts` (v2). Publishing is a
 * new-version event per docs/spec.md §5 and docs/releases.md §3: in-progress Audits stay pinned to
 * the version they were started and rated against, and only new Audits pick this up.
 *
 * Idempotent by content rather than by a marker item. The Tier A expansion script could check "are
 * all three automationKeys present", but that primitive doesn't exist for manual items — they have
 * no automationKey — so this checks whether the active version already carries the v3 change note.
 * That works for any future revision, which the automationKey trick would not.
 *
 * Runs against DIRECT_DATABASE_URL: the runtime app role has SELECT only on template tables, by
 * design (templates are product-owned content, not tenant data — no consultant can edit them).
 */

import { PrismaClient } from "@prisma/client";

import { TEMPLATE_DEFINITIONS } from "../src/lib/templates/content";
import { V3_CHANGE_NOTE, buildEvidenceDepthItems } from "../src/lib/templates/evidenceDepth";
import { assertClientFacingDescriptions, publishTemplateVersion } from "../src/lib/templates/publish";

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_DATABASE_URL must be set — template publishing needs migration-level rights.");
}

const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  for (const definition of TEMPLATE_DEFINITIONS) {
    const items = buildEvidenceDepthItems(definition.slug, definition.specificItems);

    // Every item in a v3 template is content authored under the client-facing rule, so the strict
    // check applies to the whole set here, not just to the newly-added items.
    assertClientFacingDescriptions(items, definition.slug);

    const active = await prisma.template.findFirst({
      where: { slug: definition.slug, isActive: true },
      select: { id: true, version: true, changeNote: true },
    });

    if (!active) {
      throw new Error(
        `No active template for "${definition.slug}" — run prisma/seed.ts and ` +
          "scripts/publish-tierA-expansion.ts first.",
      );
    }

    if (active.changeNote === V3_CHANGE_NOTE) {
      console.log(`Skipping "${definition.name}" — v${active.version} is already the evidence-depth version.`);
      continue;
    }

    const published = await publishTemplateVersion(prisma, {
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      items,
      changeNote: V3_CHANGE_NOTE,
    });

    const structured = items.filter((item) => item.fieldSchema).length;
    console.log(
      `Published "${published.name}" v${published.version} (${published.items.length} items, ` +
        `${structured} with structured capture, was v${active.version}).`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
