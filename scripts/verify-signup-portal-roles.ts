/**
 * One-off verification script (not part of the app) for the two newest narrow-privilege roles:
 * closecheck_signup (prisma/migrations/20260918100000_signup_role) and closecheck_portal
 * (prisma/migrations/20260918100100_portal_role). Confirms each can do exactly the one thing it's
 * for, and nothing else — mirroring the fail-closed assertions scripts/verify-rls.ts already makes
 * for the tenant-isolation policies.
 *
 * Run with: npx tsx -r dotenv/config scripts/verify-signup-portal-roles.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withOrgScope } from "@/lib/db/scoped";

const signupPrisma = new PrismaClient({ datasourceUrl: process.env.SIGNUP_DATABASE_URL });
const portalPrisma = new PrismaClient({ datasourceUrl: process.env.PORTAL_DATABASE_URL });

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

  // --- closecheck_signup: can create an org+user, cannot read anything, cannot write anywhere else.
  //
  // Deliberately plain INSERT via $executeRaw, not Prisma's create(): Postgres requires SELECT
  // privilege on a table to honor an INSERT ... RETURNING clause (which create() always uses to hand
  // back the created row), even though INSERT alone doesn't need it — confirmed by hitting exactly
  // this "permission denied" wall while building this script. Granting SELECT back to closecheck_signup
  // just to satisfy RETURNING would mean any bug or credential leak on this connection could browse
  // every org's users (including password hashes), not just insert one — defeating the entire point
  // of a read-nothing role. src/lib/actions/auth.ts's real signUp() must use this same $executeRaw
  // shape, not signupPrisma.consultantOrg.create()/user.create().
  const orgId = randomUUID();
  const userId = randomUUID();
  await signupPrisma.$executeRaw`
    INSERT INTO "consultant_orgs" (id, name, "createdAt", "updatedAt")
    VALUES (${orgId}, 'Signup Role Test Org', now(), now())
  `;
  console.log("PASS: closecheck_signup created a ConsultantOrg via raw INSERT (no RETURNING)");

  const email = `signup-role-test-${randomUUID()}@closecheck.local`;
  await signupPrisma.$executeRaw`
    INSERT INTO "users" (id, "orgId", email, "passwordHash", role, "createdAt")
    VALUES (${userId}, ${orgId}, ${email}, 'x', 'OWNER', now())
  `;
  console.log("PASS: closecheck_signup created the org's owner User via raw INSERT (no RETURNING)");

  ok = (await expectDenied("closecheck_signup SELECT on consultant_orgs", () => signupPrisma.consultantOrg.findMany())) && ok;
  ok =
    (await expectDenied("closecheck_signup INSERT on engagements", () =>
      signupPrisma.engagement.create({ data: { orgId, businessName: "should not be allowed" } }),
    )) && ok;

  // --- closecheck_portal: only the exact live token's link/report are visible; nothing else is.
  const template = await prisma.template.findFirstOrThrow({ where: { isActive: true } });
  const portalTestOrgId = randomUUID();
  const { linkId, reportId, orgId: portalOrgId } = await withOrgScope(portalTestOrgId, async (tx) => {
    const portalOrg = await tx.consultantOrg.create({ data: { id: portalTestOrgId, name: "Portal Role Test Org" } });
    const engagement = await tx.engagement.create({
      data: { orgId: portalOrg.id, businessName: "Portal Role Test Engagement" },
    });
    const audit = await tx.audit.create({
      data: { orgId: portalOrg.id, engagementId: engagement.id, templateId: template.id },
    });
    const report = await tx.report.create({
      data: { orgId: portalOrg.id, auditId: audit.id, computedOverallSeverity: "GREEN" },
    });
    const link = await tx.clientPortalLink.create({
      data: {
        orgId: portalOrg.id,
        reportId: report.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return { linkId: link.id, reportId: report.id, orgId: portalOrg.id, token: link.token };
  });

  const link = await withOrgScope(portalOrgId, (tx) => tx.clientPortalLink.findUniqueOrThrow({ where: { id: linkId } }));
  const token = link.token;

  const seenWithRightToken = await portalPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.portal_token', ${token}, true)`;
    return tx.clientPortalLink.findMany();
  });
  ok = seenWithRightToken.length === 1 && seenWithRightToken[0].id === linkId && ok;
  console.log(
    seenWithRightToken.length === 1
      ? "PASS: closecheck_portal sees exactly the link matching the presented token"
      : `FAIL: closecheck_portal saw ${seenWithRightToken.length} links with the right token, expected 1`,
  );

  const reportWithRightToken = await portalPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.portal_token', ${token}, true)`;
    return tx.report.findMany();
  });
  ok = reportWithRightToken.length === 1 && reportWithRightToken[0].id === reportId && ok;
  console.log(
    reportWithRightToken.length === 1
      ? "PASS: closecheck_portal sees exactly the report the token's link points at"
      : `FAIL: closecheck_portal saw ${reportWithRightToken.length} reports with the right token, expected 1`,
  );

  const seenWithWrongToken = await portalPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.portal_token', ${randomUUID()}, true)`;
    return tx.clientPortalLink.findMany();
  });
  ok = seenWithWrongToken.length === 0 && ok;
  console.log(
    seenWithWrongToken.length === 0
      ? "PASS: closecheck_portal sees nothing with a wrong/unknown token"
      : `FAIL: closecheck_portal leaked ${seenWithWrongToken.length} rows with a wrong token`,
  );

  const seenUnscoped = await portalPrisma.clientPortalLink.findMany();
  ok = seenUnscoped.length === 0 && ok;
  console.log(
    seenUnscoped.length === 0
      ? "PASS: closecheck_portal sees nothing at all with no token set (fails closed)"
      : `FAIL: closecheck_portal leaked ${seenUnscoped.length} rows with no token set`,
  );

  ok =
    (await expectDenied("closecheck_portal SELECT on findings", () => portalPrisma.finding.findMany())) && ok;

  // Raw INSERT here too, same RETURNING-needs-SELECT reasoning as the signup role above — no SELECT
  // grant exists on portal_access_log either, deliberately (this role should never be able to read
  // back who else has viewed a report). src/app/portal/[token]/page.tsx's real access-logging call
  // must use this same $executeRaw shape, not portalAccessLogEntry.create().
  await portalPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.portal_token', ${token}, true)`;
    await tx.$executeRaw`INSERT INTO "portal_access_log" (id, "linkId", "viewedAt") VALUES (${randomUUID()}, ${linkId}, now())`;
  });
  console.log("PASS: closecheck_portal logged an access entry against the right token's link");

  ok =
    (await expectDenied("closecheck_portal INSERT on portal_access_log for an unrelated linkId", () =>
      portalPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.portal_token', ${token}, true)`;
        await tx.$executeRaw`INSERT INTO "portal_access_log" (id, "linkId", "viewedAt") VALUES (${randomUUID()}, ${randomUUID()}, now())`;
      }),
    )) && ok;

  console.log(ok ? "\nPASS: signup and portal roles hold — least privilege enforced." : "\nFAIL");
  if (!ok) process.exitCode = 1;

  // Cleanup — these are throwaway fixtures, not the permanent named QA fixtures this session
  // otherwise leaves in place.
  await withOrgScope(portalOrgId, (tx) => tx.consultantOrg.delete({ where: { id: portalOrgId } }));
  await withOrgScope(orgId, (tx) => tx.consultantOrg.delete({ where: { id: orgId } }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([prisma.$disconnect(), signupPrisma.$disconnect(), portalPrisma.$disconnect()]));
