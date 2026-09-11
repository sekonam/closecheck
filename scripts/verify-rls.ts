/**
 * One-off verification script (not part of the app) for the RLS policies in
 * prisma/migrations/*_row_level_security. Confirms:
 *  1. Org A cannot see Org B's engagements via withOrgScope(orgA, ...), and vice versa.
 *  2. A query issued through the plain, unscoped Prisma client (no app.current_org_id set on that
 *     connection) returns ZERO rows on a tenant table — the fail-safe property FORCE ROW LEVEL
 *     SECURITY is supposed to give us, so a bug that skips withOrgScope fails closed, not open.
 * Run with: npx tsx scripts/verify-rls.ts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { withOrgScope } from "@/lib/db/scoped";

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

  const ok = !crossLeak && unscoped.length === 0;
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
