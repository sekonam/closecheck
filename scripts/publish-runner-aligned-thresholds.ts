/**
 * Publishes template v5 — "say what the product actually does"
 * (src/lib/templates/runnerAlignedThresholds.ts).
 *
 * Run after prisma/seed.ts (v1), publish-tierA-expansion.ts (v2), publish-evidence-depth.ts (v3)
 * and publish-evidence-backed-thresholds.ts (v4).
 *
 * This is a new-version event per docs/spec.md §5 and docs/releases.md §3, and for the same reason
 * v4 was: it changes what a threshold means. An audit rated against v4's proportion-only
 * certificate rule must keep reading against that rule — the report a buyer holds cites the
 * methodology in force when it was written, and re-basing it underneath would make the document
 * disagree with itself.
 *
 * Idempotent by change note, and refuses to run once a later revision exists, both the same way
 * v4's script is.
 *
 * Runs against DIRECT_DATABASE_URL: the runtime app role holds SELECT only on template tables by
 * design — templates are product-owned content, not tenant data.
 */

import { PrismaClient } from "@prisma/client";

import { TEMPLATE_DEFINITIONS } from "../src/lib/templates/content";
import {
  V5_CHANGE_NOTE,
  buildRunnerAlignedItems,
} from "../src/lib/templates/runnerAlignedThresholds";
import { assertClientFacingDescriptions, publishTemplateVersion } from "../src/lib/templates/publish";

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_DATABASE_URL must be set — template publishing needs migration-level rights.");
}

/** The version this revision is built on top of: the evidence-backed-thresholds revision. */
const EXPECTED_PREVIOUS_VERSION = 4;

const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  for (const definition of TEMPLATE_DEFINITIONS) {
    const items = buildRunnerAlignedItems(definition.slug, definition.specificItems);

    assertClientFacingDescriptions(items, definition.slug);

    const active = await prisma.template.findFirst({
      where: { slug: definition.slug, isActive: true },
      select: { id: true, version: true, changeNote: true },
    });

    if (!active) {
      throw new Error(
        `No active template for "${definition.slug}" — run the earlier publish scripts first.`,
      );
    }

    if (active.changeNote === V5_CHANGE_NOTE) {
      console.log(
        `Skipping "${definition.name}" — v${active.version} is already the runner-aligned version.`,
      );
      continue;
    }

    if (active.version > EXPECTED_PREVIOUS_VERSION) {
      throw new Error(
        `"${definition.slug}" is at v${active.version}; this script publishes the runner-aligned ` +
          `revision on top of v${EXPECTED_PREVIOUS_VERSION} and would otherwise republish older ` +
          "content as a newer version. It has already been superseded — don't run it.",
      );
    }

    const published = await publishTemplateVersion(prisma, {
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      items,
      changeNote: V5_CHANGE_NOTE,
    });

    console.log(
      `Published "${published.name}" v${published.version} (${published.items.length} items, ` +
        `was v${active.version}).`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
