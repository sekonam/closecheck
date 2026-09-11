import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./client";

/**
 * The application-layer half of tenant isolation (docs/spec.md §8, §10). The database-layer half is
 * the row-level security policies in prisma/migrations/*_row_level_security.
 *
 * Every query against a tenant-owned table (ConsultantOrg, Engagement, Audit, Finding, Evidence,
 * Report, ClientPortalLink — anything with an `orgId` column) MUST go through this function. Do not
 * call `prisma.<model>` directly for those tables anywhere else — see
 * .claude/skills/domain-code-review/SKILL.md, which specifically checks for this.
 *
 * `Template`/`TemplateItem` are shared, non-tenant content (spec.md §5) and are read directly via
 * `prisma` — they do not go through this helper and have no RLS policy.
 */
export type ScopedTx = Prisma.TransactionClient;

export async function withOrgScope<T>(
  orgId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  if (!orgId) {
    throw new Error("withOrgScope called without an orgId — refusing to run an unscoped query");
  }

  return prisma.$transaction(async (tx) => {
    // set_config's third argument (`true`) scopes the setting to this transaction only — it never
    // leaks to the next query on a pooled connection. Parameterized via Prisma's tagged template, not
    // string interpolation, even though orgId is server-generated (cuid), not raw user input.
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });
}

/** Escape hatch for the small number of genuinely cross-tenant operations (e.g. an admin tool with
 * its own separate audit-logged access path — spec.md §8). Not used by any route yet; exists so that
 * if one is ever needed, it's an explicit, greppable exception rather than a plain `prisma.<model>`
 * call that looks identical to a mistake. */
export function unscoped(): PrismaClient {
  return prisma;
}
