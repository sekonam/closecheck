import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { withPortalScope } from "@/lib/portal/db";
import { recordMetric } from "@/lib/metrics/record";
import { getObject } from "@/lib/storage/local";

/**
 * Public, unauthenticated Client Portal view (spec.md §7) — a buyer with no CloseCheck account,
 * authorized by the token in the URL alone. Lives outside the (app) route group entirely, like
 * /login and /signup.
 *
 * withPortalScope's RLS policies (prisma/migrations/20260918100100_portal_role) already refuse to
 * return a link that's missing, revoked, or expired — the null check below is genuinely "no such
 * link" in every one of those cases, and deliberately doesn't distinguish them in what's shown to
 * the visitor (telling an ex-buyer "this link was revoked" vs. "this link never existed" leaks more
 * than a report link's existence should).
 */
export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const result = await withPortalScope(token, async (tx) => {
    const link = await tx.clientPortalLink.findFirst({ where: { token } });
    if (!link) return null;

    const report = await tx.report.findFirst({ where: { id: link.reportId } });
    if (!report) return null;

    // Raw INSERT, not portalAccessLogEntry.create(): closecheck_portal has no SELECT grant on
    // portal_access_log (see src/lib/portal/db.ts's docstring and scripts/verify-signup-portal-roles.ts),
    // and Postgres requires SELECT to honor the RETURNING clause create() always uses.
    const forwardedFor = (await headers()).get("x-forwarded-for");
    const ipHash = forwardedFor
      ? createHash("sha256").update(forwardedFor.split(",")[0].trim()).digest("hex")
      : null;
    await tx.$executeRaw`
      INSERT INTO "portal_access_log" (id, "linkId", "viewedAt", "ipHash")
      VALUES (${randomUUID()}, ${link.id}, (now() AT TIME ZONE 'utc'), ${ipHash})
    `;

    return { report, orgId: link.orgId };
  });

  if (!result) notFound();
  const { report } = result;

  // Telemetry (spec.md §11 report-usage signal). Via the app-role client's INSERT-only grant, not
  // the portal role — carries only ids, and failure never affects the buyer's view.
  void recordMetric("portal.viewed", { orgId: result.orgId, data: { reportId: report.id } });

  if (!report.pdfStorageKey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Report not ready</h1>
        <p className="max-w-sm text-sm text-slate-500">
          This link is valid, but the report it points to doesn&apos;t have a generated PDF yet.
          Contact the firm that shared this link.
        </p>
      </div>
    );
  }

  const pdfBytes = await getObject(report.pdfStorageKey);
  const pdfDataUri = `data:application/pdf;base64,${pdfBytes.toString("base64")}`;

  return (
    <div className="flex flex-1 flex-col px-4 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-sm font-medium text-slate-900">Shared due-diligence report</h1>
          <span className="text-xs text-slate-400">Read-only — shared via CloseCheck</span>
        </div>
        <embed
          src={pdfDataUri}
          type="application/pdf"
          className="w-full flex-1 rounded-lg border border-slate-200"
          style={{ minHeight: "80vh" }}
        />
        <p className="mt-3 text-center text-xs text-slate-400">
          This link is scoped to one report and can be revoked by the firm that shared it at any
          time.
        </p>
      </div>
    </div>
  );
}
