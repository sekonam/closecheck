/**
 * One-off verification script (not part of the app) for the RLS policies in
 * prisma/migrations/*_row_level_security. Confirms:
 *  1. Org A cannot see Org B's engagements via withOrgScope(orgA, ...), and vice versa.
 *  2. A query issued through the plain, unscoped Prisma client (no app.current_org_id set on that
 *     connection) returns ZERO rows on a tenant table — the fail-safe property FORCE ROW LEVEL
 *     SECURITY is supposed to give us, so a bug that skips withOrgScope fails closed, not open.
 *  3. That EVERY org-owned table is isolated, not just the one checks 1 and 2 drive.
 * Run with: npx tsx scripts/verify-rls.ts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { withOrgScope } from "@/lib/db/scoped";

/**
 * Checks 1 and 2 above prove isolation by driving it — two real orgs, real rows, a real cross-read
 * that comes back empty. That is the right way to prove the mechanism works, and it proves it for
 * `engagements`.
 *
 * It proves nothing whatsoever about a table added next month. A new Prisma model whose migration
 * declares the table and forgets `ENABLE ROW LEVEL SECURITY` passes this script unchanged, because
 * this script never looks at it — and passes code review too, since the omission is a missing line
 * in a migration rather than a wrong one in a diff. The failure is then invisible until the table
 * holds two firms' rows.
 *
 * So this enumerates instead of sampling: every table carrying an `orgId` must be isolated.
 *
 * There are TWO legitimate ways to be isolated, and demanding only the first reports a deliberate
 * design as a defect. Most tables use forced RLS. `metric_events` and `error_events` deliberately
 * do not — they are write-only telemetry whose isolation is that the app role holds INSERT and no
 * SELECT at all (see src/lib/metrics/record.ts). A check that flagged those two would be explained
 * away once and then ignored permanently, which costs more than not having it.
 *
 * `has_table_privilege` rather than `information_schema.role_table_grants`: the former reports the
 * privilege the role EFFECTIVELY has, including anything inherited through role membership or a
 * grant to PUBLIC. Those are precisely the ways a table could be readable while the grant table
 * looks clean.
 */
async function verifyEveryOrgOwnedTableIsIsolated(): Promise<boolean> {
  // The role this connection is actually using, so the check cannot drift from reality if the role
  // is ever renamed.
  const [{ role }] = await prisma.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;

  const tables = await prisma.$queryRaw<
    { relname: string; forced: boolean; readable: boolean }[]
  >`
    SELECT c.relname,
           (c.relrowsecurity AND c.relforcerowsecurity) AS forced,
           has_table_privilege(${role}, c.oid, 'SELECT') AS readable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = c.relname AND column_name = 'orgId')
    ORDER BY c.relname
  `;

  // An empty result is not a pass. It means the schema is not there, or the catalogue query stopped
  // matching what the migrations produce — either way this check asserted nothing, and saying so is
  // the whole difference between a verifier and a decoration.
  if (tables.length === 0) {
    console.log("FAIL: found no org-owned tables at all. Migrations not applied, or this query is wrong.");
    return false;
  }

  const unprotected = tables.filter((t) => !t.forced && t.readable);
  console.log(
    `Org-owned tables: ${tables.length} — ${tables.filter((t) => t.forced).length} with forced RLS, ` +
      `${tables.filter((t) => !t.forced && !t.readable).length} write-only (no SELECT for ${role}).`,
  );
  if (unprotected.length > 0) {
    console.log(
      `FAIL: these carry an orgId, have no forced RLS, and ${role} can SELECT them — ` +
        `they return every firm's rows to any signed-in user: ${unprotected.map((t) => t.relname).join(", ")}`,
    );
    return false;
  }
  console.log("PASS: every org-owned table is isolated (forced RLS, or no SELECT for the app role).");
  return true;
}

async function main() {
  // consultant_orgs' own RLS policy (id = current_setting(...)) applies to INSERT too, via
  // FORCE ROW LEVEL SECURITY's WITH CHECK — so even creating a new org must go through
  // withOrgScope with the id pre-generated and passed explicitly, not the plain unscoped client.
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const orgA = await withOrgScope(orgAId, (tx) =>
    tx.consultantOrg.create({ data: { id: orgAId, name: "RLS Test Org A" } }),
  );
  const orgB = await withOrgScope(orgBId, (tx) =>
    tx.consultantOrg.create({ data: { id: orgBId, name: "RLS Test Org B" } }),
  );

  await withOrgScope(orgA.id, (tx) =>
    tx.engagement.create({ data: { orgId: orgA.id, businessName: "Org A Deal" } }),
  );
  await withOrgScope(orgB.id, (tx) =>
    tx.engagement.create({ data: { orgId: orgB.id, businessName: "Org B Deal" } }),
  );

  const seenByA = await withOrgScope(orgA.id, (tx) => tx.engagement.findMany());
  const seenByB = await withOrgScope(orgB.id, (tx) => tx.engagement.findMany());

  console.log("Org A sees:", seenByA.map((e) => e.businessName));
  console.log("Org B sees:", seenByB.map((e) => e.businessName));

  const crossLeak =
    seenByA.some((e) => e.businessName === "Org B Deal") ||
    seenByB.some((e) => e.businessName === "Org A Deal") ||
    seenByA.length !== 1 ||
    seenByB.length !== 1;

  // No withOrgScope at all — app.current_org_id is unset on this connection.
  const unscoped = await prisma.engagement.findMany({
    where: { businessName: { in: ["Org A Deal", "Org B Deal"] } },
  });
  console.log("Unscoped client sees (should be 0 rows):", unscoped.length);

  const everyTableIsolated = await verifyEveryOrgOwnedTableIsIsolated();

  const ok = !crossLeak && unscoped.length === 0 && everyTableIsolated;
  console.log(ok ? "PASS: RLS holds — no cross-tenant leak, unscoped access fails closed." : "FAIL");
  if (!ok) process.exitCode = 1;

  // consultant_orgs' own RLS policy scopes by its own id, and deleting it cascades to its
  // engagements at the FK level (bypassing RLS for the cascade itself) — so each delete must run
  // inside that org's own scope, not via the plain unscoped client (which RLS would silently no-op).
  await withOrgScope(orgA.id, (tx) => tx.consultantOrg.delete({ where: { id: orgA.id } }));
  await withOrgScope(orgB.id, (tx) => tx.consultantOrg.delete({ where: { id: orgB.id } }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
