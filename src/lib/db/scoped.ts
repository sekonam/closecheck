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

/**
 * NOT a cross-tenant escape hatch, despite how that might read — correcting an earlier version of
 * this comment that claimed otherwise. Under the RLS design (prisma/migrations/*_row_level_security,
 * *_least_privilege_app_role), the `prisma` client's role (`closecheck_app`) has no access to a
 * tenant table's rows unless `app.current_org_id` is set on that connection — with no org scope set,
 * every tenant-table query returns zero rows, full stop (verified by scripts/verify-rls.ts's
 * "unscoped client sees 0 rows" assertion). This function exists only for the same non-tenant
 * content withOrgScope's own docstring already carves out (Template/TemplateItem) if a caller wants
 * the plain client without importing it from ./client directly.
 *
 * A genuine cross-tenant operation (found a real one: scripts/purge-expired-documents.ts, which has
 * to find engagements due for purge across every org) needs a connection using the
 * DIRECT_DATABASE_URL superuser role instead — the same role migrations use, for the same reason:
 * `closecheck_app` cannot do this by design, not by oversight. Build that as its own standalone
 * script with its own audit trail, the way that one does — never by widening this function.
 */
export function unscoped(): PrismaClient {
  return prisma;
}
