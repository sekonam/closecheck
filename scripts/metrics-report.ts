/**
 * The founder's read path for Phase 2.5 telemetry (docs/roadmap.md Phase 2.5, spec.md §11): the app
 * role can only INSERT into metric_events/error_events (prisma/migrations/20260922090000), so this
 * report runs on DIRECT_DATABASE_URL — the same trust boundary migrations and seeds use. Object
 * counts (orgs, audits, reports, portal views) come from the source tables as ground truth; event
 * counts come from metric_events.
 *
 * Run with: npm run metrics:report
 */
import { PrismaClient } from "@prisma/client";

const directPrisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

function line(label: string, value: number | string) {
  console.log(`  ${label.padEnd(52, ".")} ${value}`);
}

async function main() {
  const [orgs, orgsWithAudit, orgsWithSecondAudit, auditsCompleted, reports, portalViews] =
    await Promise.all([
      directPrisma.consultantOrg.count(),
      directPrisma
        .$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "orgId") AS n FROM audits`
        .then((r) => Number(r[0]?.n ?? 0)),
      directPrisma
        .$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM (
            SELECT "orgId" FROM audits GROUP BY "orgId" HAVING COUNT(*) >= 2
          ) multi`
        .then((r) => Number(r[0]?.n ?? 0)),
      directPrisma.audit.count({ where: { status: "COMPLETE" } }),
      directPrisma.report.count(),
      directPrisma.portalAccessLogEntry.count(),
    ]);

  console.log("\nCloseCheck metrics (spec.md §11)");
  console.log("=".repeat(60));
  line("Orgs (total signed up)", orgs);
  line("Activation: orgs with ≥1 audit created", orgsWithAudit);
  line("Retention proxy: orgs with ≥2 audits", orgsWithSecondAudit);
  line("Audits marked complete", auditsCompleted);
  line("Reports generated", reports);
  line("Portal link views (report usage signal)", portalViews);

  const eventCounts = await directPrisma.$queryRaw<{ type: string; n: bigint }[]>`
    SELECT type, COUNT(*) AS n FROM metric_events GROUP BY type ORDER BY type
  `;
  console.log("\nEvent stream (metric_events)");
  console.log("=".repeat(60));
  if (eventCounts.length === 0) {
    console.log("  (no events recorded yet)");
  }
  for (const row of eventCounts) {
    line(row.type, Number(row.n));
  }

  const errorsBySource = await directPrisma.$queryRaw<{ source: string; n: bigint }[]>`
    SELECT source, COUNT(*) AS n FROM error_events
    WHERE "createdAt" > now() - interval '7 days'
    GROUP BY source ORDER BY n DESC
  `;
  console.log("\nErrors, last 7 days (error_events)");
  console.log("=".repeat(60));
  if (errorsBySource.length === 0) {
    console.log("  (none)");
  }
  for (const row of errorsBySource) {
    line(row.source, Number(row.n));
  }

  const recentErrors = await directPrisma.errorEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true, source: true, message: true },
  });
  if (recentErrors.length > 0) {
    console.log("\nMost recent errors");
    console.log("=".repeat(60));
    for (const e of recentErrors) {
      console.log(`  ${e.createdAt.toISOString()}  [${e.source}]  ${e.message.slice(0, 120)}`);
    }
  }
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await directPrisma.$disconnect();
  });
