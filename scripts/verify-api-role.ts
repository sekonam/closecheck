/**
 * One-off verification script (not part of the app) for the closecheck_api role
 * (prisma/migrations/20260921120000_api_keys_and_webhooks) and the read-only API's org scoping —
 * the concrete test docs/releases.md §5's Phase 4 launch gate calls for: API keys proven org-scoped
 * at the RLS layer via an actual cross-org request, not by trusting application code.
 *
 * Confirms closecheck_api can do exactly its one job (find an api_keys row by token hash, touch
 * lastUsedAt) and nothing else, and that the org an authenticated key resolves to cannot read
 * another org's data through withOrgScope — mirroring scripts/verify-signup-portal-roles.ts.
 *
 * Run with: npx tsx -r dotenv/config scripts/verify-api-role.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { withOrgScope } from "@/lib/db/scoped";
import { generateApiToken } from "@/lib/api/auth";

const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const apiRolePrisma = new PrismaClient({ datasourceUrl: process.env.API_DATABASE_URL });

async function expectDenied(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    console.log(`FAIL: ${label} — expected this to be denied, but it succeeded`);
    return false;
  } catch {
    console.log(`PASS: ${label} correctly denied`);
    return true;
  }
}

async function main() {
  let ok = true;

  // Fixture: two orgs, one engagement each, one API key each — created via the direct role, the same
  // bootstrap pattern as prisma/seed.ts.
  const orgA = `verify-api-a-${randomUUID()}`;
  const orgB = `verify-api-b-${randomUUID()}`;
  const engagementA = randomUUID();
  const engagementB = randomUUID();
  const keyA = generateApiToken();
  const keyAId = randomUUID();

  await directPrisma.$transaction([
    directPrisma.consultantOrg.create({ data: { id: orgA, name: "Verify API Org A" } }),
    directPrisma.consultantOrg.create({ data: { id: orgB, name: "Verify API Org B" } }),
    directPrisma.engagement.create({ data: { id: engagementA, orgId: orgA, businessName: "A Diner" } }),
    directPrisma.engagement.create({ data: { id: engagementB, orgId: orgB, businessName: "B Salon" } }),
    directPrisma.apiKey.create({
      data: { id: keyAId, orgId: orgA, name: "verify", tokenHash: keyA.tokenHash, tokenPrefix: keyA.tokenPrefix },
    }),
  ]);

  try {
    // --- closecheck_api: the one thing it exists for works.
    const found = await apiRolePrisma.apiKey.findUnique({ where: { tokenHash: keyA.tokenHash } });
    if (found?.orgId === orgA) {
      console.log("PASS: closecheck_api resolves a token hash to its key row (cross-org lookup)");
    } else {
      console.log("FAIL: closecheck_api could not resolve the token hash");
      ok = false;
    }

    await apiRolePrisma.apiKey.update({ where: { id: keyAId }, data: { lastUsedAt: new Date() } });
    console.log("PASS: closecheck_api can update lastUsedAt");

    // --- ...and nothing else.
    ok = (await expectDenied("closecheck_api reading engagements", () =>
      apiRolePrisma.$queryRaw`SELECT id FROM "engagements" LIMIT 1`,
    )) && ok;
    ok = (await expectDenied("closecheck_api reading users", () =>
      apiRolePrisma.$queryRaw`SELECT id FROM "users" LIMIT 1`,
    )) && ok;
    ok = (await expectDenied("closecheck_api reading webhook_endpoints (signing secrets)", () =>
      apiRolePrisma.$queryRaw`SELECT id FROM "webhook_endpoints" LIMIT 1`,
    )) && ok;
    ok = (await expectDenied("closecheck_api rewriting a key's revokedAt (column-scoped grant)", () =>
      apiRolePrisma.$executeRaw`UPDATE "api_keys" SET "revokedAt" = now() WHERE id = ${keyAId}`,
    )) && ok;
    ok = (await expectDenied("closecheck_api rewriting a key's orgId (column-scoped grant)", () =>
      apiRolePrisma.$executeRaw`UPDATE "api_keys" SET "orgId" = ${orgB} WHERE id = ${keyAId}`,
    )) && ok;

    // --- The cross-org request itself: org A's key + withOrgScope(orgA), exactly what the API route
    // does, must see org A's engagement and must NOT see org B's.
    const own = await withOrgScope(orgA, (tx) => tx.engagement.findUnique({ where: { id: engagementA } }));
    const foreign = await withOrgScope(orgA, (tx) => tx.engagement.findUnique({ where: { id: engagementB } }));
    if (own && !foreign) {
      console.log("PASS: an org A API request reads org A's engagement and gets zero rows for org B's");
    } else {
      console.log(
        `FAIL: cross-org API read — own=${own ? "visible" : "MISSING"}, foreign=${foreign ? "VISIBLE (leak!)" : "hidden"}`,
      );
      ok = false;
    }
  } finally {
    await directPrisma.consultantOrg.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  }

  if (!ok) {
    process.exitCode = 1;
    console.log("\nRESULT: FAIL — do not enable the API for customers with any of the above failing.");
  } else {
    console.log("\nRESULT: PASS — closecheck_api is correctly narrow and API reads are org-scoped by RLS.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await Promise.all([directPrisma.$disconnect(), apiRolePrisma.$disconnect()]);
  });
