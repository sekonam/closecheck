/**
 * Publishes template v4 — "evidence-backed thresholds"
 * (src/lib/templates/evidenceBackedThresholds.ts).
 *
 * Run after `prisma/seed.ts` (v1), `scripts/publish-tierA-expansion.ts` (v2) and
 * `scripts/publish-evidence-depth.ts` (v3). Publishing is a new-version event per docs/spec.md §5
 * and docs/releases.md §3: in-progress Audits stay pinned to the version they were started and
 * rated against, and only new Audits pick this up. That matters more for v4 than it did for v3 —
 * this revision changes what several severity thresholds *are*, so an audit rated against v3's
 * fixed 30-day certificate rule must keep reading against that rule rather than silently acquiring
 * a proportional one.
 *
 * Idempotent by content, the same way v3's script is: it checks whether the active version already
 * carries the v4 change note rather than looking for a marker item, which works for manual items
 * (they have no automationKey) and for any future revision.
 *
 * Runs against DIRECT_DATABASE_URL: the runtime app role has SELECT only on template tables, by
 * design (templates are product-owned content, not tenant data — no consultant can edit them).
 */

import { PrismaClient } from "@prisma/client";

import { TEMPLATE_DEFINITIONS } from "../src/lib/templates/content";
import {
  V4_CHANGE_NOTE,
  buildEvidenceBackedItems,
} from "../src/lib/templates/evidenceBackedThresholds";
import { assertClientFacingDescriptions, publishTemplateVersion } from "../src/lib/templates/publish";

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_DATABASE_URL must be set — template publishing needs migration-level rights.");
}

/** The version this revision is built on top of: the evidence-depth revision. */
const EXPECTED_PREVIOUS_VERSION = 3;

const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  for (const definition of TEMPLATE_DEFINITIONS) {
    const items = buildEvidenceBackedItems(definition.slug, definition.specificItems);

    // Every item in a v4 template is content authored under the client-facing rule, so the strict
    // check applies to the whole set here, not just to the newly-added items.
    assertClientFacingDescriptions(items, definition.slug);

    const active = await prisma.template.findFirst({
      where: { slug: definition.slug, isActive: true },
      select: { id: true, version: true, changeNote: true },
    });

    if (!active) {
      throw new Error(
        `No active template for "${definition.slug}" — run prisma/seed.ts, ` +
          "scripts/publish-tierA-expansion.ts and scripts/publish-evidence-depth.ts first.",
      );
    }

    if (active.changeNote === V4_CHANGE_NOTE) {
      console.log(
        `Skipping "${definition.name}" — v${active.version} is already the evidence-backed-thresholds version.`,
      );
      continue;
    }

    // Refuses to run once a later revision has been published. The change-note check above makes
    // this idempotent against a double run today, but after a v5 exists the active version's note
    // would be v5's — and this script would happily publish v4's content as v6, silently reverting
    // whatever v5 changed. A publish script for an older revision must never be able to move a
    // template forwards into the past.
    if (active.version > EXPECTED_PREVIOUS_VERSION) {
      throw new Error(
        `"${definition.slug}" is at v${active.version}; this script publishes the ` +
          `evidence-backed-thresholds revision on top of v${EXPECTED_PREVIOUS_VERSION} and would ` +
          "otherwise republish older content as a newer version. It has already been superseded — " +
          "don't run it.",
      );
    }

    const published = await publishTemplateVersion(prisma, {
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      items,
      changeNote: V4_CHANGE_NOTE,
    });

    const sourced = items.filter((item) => item.severityGuidance).length;
    console.log(
      `Published "${published.name}" v${published.version} (${published.items.length} items, ` +
        `${sourced} carrying a severity rubric, was v${active.version}).`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
