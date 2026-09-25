import type { Prisma } from "@prisma/client";
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
 * `prisma`, imported from ./client — they do not go through this helper and have no RLS policy.
 *
 * There is deliberately no "unscoped" escape hatch exported from this file for tenant tables: under
 * this RLS design, the `prisma` client's role (`closecheck_app`) has no access to a tenant table's
 * rows unless `app.current_org_id` is set on that connection — with no org scope set, every
 * tenant-table query returns zero rows, full stop (verified by scripts/verify-rls.ts's "unscoped
 * client sees 0 rows" assertion). A genuine cross-tenant operation — the one that exists,
 * scripts/purge-expired-documents.ts, which has to find engagements due for purge across every org
 * — needs its own connection using the DIRECT_DATABASE_URL superuser role instead, the same role
 * migrations use, for the same reason: `closecheck_app` cannot do this by design, not by oversight.
 * Build that as its own standalone script with its own audit trail, the way that one does — an
 * `unscoped()` helper here would look like a working shortcut and just silently return empty
 * results for every tenant table, which is worse than not offering one.
 */
export type ScopedTx = Prisma.TransactionClient;

export async function withOrgScope<T>(
  orgId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  if (!orgId) {
    throw new Error("withOrgScope called without an orgId — refusing to run an unscoped query");
  }

  return prisma.$transaction(
    async (tx) => {
      // set_config's third argument (`true`) scopes the setting to this transaction only — it never
      // leaks to the next query on a pooled connection. Parameterized via Prisma's tagged template,
      // not string interpolation, even though orgId is server-generated (cuid), not raw user input.
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      return fn(tx);
    },
    /**
     * Interactive-transaction budget. Prisma's defaults (2s to acquire, 5s to run) stay the
     * defaults, and CLOSECHECK_TX_MAX_WAIT_MS / CLOSECHECK_TX_TIMEOUT_MS override them per
     * deployment. The reasoning is measured, not argued, and it went both ways on 2026-09-25:
     *
     * Under a stalled event loop (four browsers and PDF renders on one machine) every page and
     * action answered 500 at the session check, because every one of them opens one of these and
     * a 5s budget turns a few-second stall into an outage. Raising the budget to 20s looked like
     * the fix — and the full E2E suite then hung one row that had passed at 5s under heavier load,
     * while the server log showed POSTs queued for 24–94s with zero transaction errors. A long
     * budget under pool contention does not absorb a stall; it queues every request behind every
     * other one and moves the failure to whoever is waiting. At 5s the same suite is 176/176.
     *
     * So the default is the alarm, and an operator running a small box that renders PDFs can
     * raise it deliberately once a real stall — not a test matrix — is what they are seeing.
     */
    transactionBudget(),
  );
}

/**
 * The interactive-transaction budget, overridable per deployment without a code change. Defaults
 * are Prisma's own; see the note at the call site for why raising them is an operator's decision
 * against a measured stall and not a default.
 */
export function transactionBudget(): { maxWait: number; timeout: number } {
  const maxWait = Number(process.env.CLOSECHECK_TX_MAX_WAIT_MS);
  const timeout = Number(process.env.CLOSECHECK_TX_TIMEOUT_MS);
  return {
    maxWait: Number.isFinite(maxWait) && maxWait > 0 ? maxWait : 2_000,
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 5_000,
  };
}
