import { PrismaClient } from "@prisma/client";
import { generateApiToken } from "@/lib/api/auth";

/**
 * Fixture builder for the integration suite.
 *
 * Deliberately connects as the DIRECT_DATABASE_URL superuser role — the same role migrations use —
 * rather than `closecheck_app`. Fixtures have to create rows for *two different orgs* and then
 * assert that neither can see the other; doing setup through the RLS-scoped app client would mean
 * the test harness shares the very mechanism it is supposed to be testing, so a broken policy could
 * make both the setup and the assertion wrong in the same direction and the test would still pass.
 * Setup bypasses RLS on purpose; every assertion goes through a scoped path.
 */
const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

export type OrgFixture = {
  orgId: string;
  orgName: string;
  userId: string;
  userEmail: string;
  engagementId: string;
  auditId: string;
  findingId: string;
  reportId: string;
  /** Plaintext bearer token — exists only here and in the caller; the DB holds sha256(token). */
  apiToken: string;
  apiKeyId: string;
  /** A second key, revoked at creation, for the revoked-key assertions. */
  revokedApiToken: string;
};

/** Unique-enough suffix so concurrent runs (and a peer session's dev server) never collide. */
function uniq(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Picks any active seeded Template. The suite asserts isolation and payload shape, neither of which
 * depends on *which* template — binding to a specific slug would make these tests fail whenever the
 * template library changes, which is a different session's active work area.
 */
async function anyActiveTemplate() {
  const template = await directPrisma.template.findFirst({
    where: { isActive: true },
    include: { items: { orderBy: { sortOrder: "asc" }, take: 1 } },
  });
  if (!template || template.items.length === 0) {
    throw new Error(
      "No active template with items found. Run `npm run db:seed` before the integration suite.",
    );
  }
  return template;
}

export async function createOrgFixture(label: string): Promise<OrgFixture> {
  const suffix = uniq();
  const orgName = `itest-${label}-${suffix}`;
  const template = await anyActiveTemplate();
  const templateItemId = template.items[0].id;

  const org = await directPrisma.consultantOrg.create({ data: { name: orgName } });
  const user = await directPrisma.user.create({
    data: {
      orgId: org.id,
      email: `${orgName}@itest.invalid`,
      // Not a real credential: no integration test signs in as this user. Sign-in paths are covered
      // by the unit suite and the browser E2E run, not here.
      passwordHash: "itest-not-a-real-hash",
      name: `Integration ${label}`,
      role: "OWNER",
    },
  });

  const engagement = await directPrisma.engagement.create({
    data: {
      orgId: org.id,
      businessName: `${label} Diner ${suffix}`,
      primaryDomain: `${label}-${suffix}.invalid`,
    },
  });

  const audit = await directPrisma.audit.create({
    data: { orgId: org.id, engagementId: engagement.id, templateId: template.id, status: "COMPLETE" },
  });

  // Finding content is deliberately recognizable: the webhook payload test greps outgoing bodies for
  // these exact strings to prove findings content never leaves the system in a webhook (spec.md §13.3).
  const finding = await directPrisma.finding.create({
    data: {
      orgId: org.id,
      auditId: audit.id,
      templateItemId,
      status: "FAIL",
      severity: "RED",
      note: SECRET_FINDING_NOTE,
      structuredData: { secretField: SECRET_STRUCTURED_VALUE },
    },
  });

  const report = await directPrisma.report.create({
    data: {
      orgId: org.id,
      auditId: audit.id,
      computedOverallSeverity: "RED",
      overallCoveredCount: 1,
      overallTotalCount: 1,
    },
  });

  const live = generateApiToken();
  const apiKey = await directPrisma.apiKey.create({
    data: {
      orgId: org.id,
      name: `itest ${label}`,
      tokenHash: live.tokenHash,
      tokenPrefix: live.tokenPrefix,
    },
  });

  const revoked = generateApiToken();
  await directPrisma.apiKey.create({
    data: {
      orgId: org.id,
      name: `itest ${label} revoked`,
      tokenHash: revoked.tokenHash,
      tokenPrefix: revoked.tokenPrefix,
      revokedAt: new Date(),
    },
  });

  return {
    orgId: org.id,
    orgName,
    userId: user.id,
    userEmail: user.email,
    engagementId: engagement.id,
    auditId: audit.id,
    findingId: finding.id,
    reportId: report.id,
    apiToken: live.token,
    apiKeyId: apiKey.id,
    revokedApiToken: revoked.token,
  };
}

/** Sentinel strings planted in finding content so payload tests can assert they never escape. */
export const SECRET_FINDING_NOTE =
  "SENTINEL_FINDING_NOTE_must_never_appear_in_a_webhook_payload";
export const SECRET_STRUCTURED_VALUE =
  "SENTINEL_STRUCTURED_VALUE_must_never_appear_in_a_webhook_payload";

/** Cascades to users, engagements, audits, findings, reports, api keys and webhook endpoints. */
export async function destroyOrgFixture(orgId: string): Promise<void> {
  await directPrisma.consultantOrg.delete({ where: { id: orgId } }).catch(() => {
    // A test that already removed the org must not fail teardown.
  });
}

export async function createWebhookEndpoint(orgId: string, url: string) {
  return directPrisma.webhookEndpoint.create({
    data: { orgId, url, secret: `whsec_itest_${uniq()}` },
  });
}

export { directPrisma };
