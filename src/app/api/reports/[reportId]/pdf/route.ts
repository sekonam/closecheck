import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { withOrgScope, type ScopedTx } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/local";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const { orgId, userId } = await requireOrgSession();

  const report = await withOrgScope(orgId, (tx) =>
    tx.report.findUnique({ where: { id: reportId }, include: { audit: { include: { engagement: true } } } }),
  );

  // withOrgScope's RLS policy already prevents this from resolving a different org's report; the
  // null check below is "not found" (wrong id, or genuinely not generated yet), not a tenant leak.
  if (!report || !report.pdfStorageKey) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await getObject(report.pdfStorageKey);
  } catch {
    // The row points at a file that is gone (database restored onto a fresh volume, file removed by
    // hand). Same treatment as /api/evidence/[evidenceId] and /api/branding/logo: a 404, not an
    // unhandled 500 — which also stops the instrumentation hook recording a spurious error_events
    // row for a condition that is not a fault in the request.
    return NextResponse.json({ error: "Report file not found" }, { status: 404 });
  }

  await logReportExport(orgId, userId, report.id);

  const filename = `closecheck-${report.audit.engagement.businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${report.id}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Tenant-scoped content behind a session: never hold it in a shared cache.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * spec.md §8 promises an access trail for "who viewed/exported/shared a given Report and when."
 * Portal views were logged (portal_access_log); the consultant-side export — the path by which the
 * PDF most often actually leaves the system, attached to an email — logged nothing at all, so the
 * trail a consultant would show a buyer's advisory team had a hole in exactly the place the
 * document leaves.
 *
 * Written the same way the portal logs a view: a raw INSERT (Prisma's create() emits
 * INSERT ... RETURNING, and these event tables grant INSERT without SELECT), inside the same
 * org-scoped transaction, awaited rather than fire-and-forget — an export that is not recorded is
 * the failure this exists to prevent, so it is worth the round trip.
 *
 * This is deliberately NOT the end state. metric_events is product telemetry with no SELECT grant
 * for the app role, readable only by scripts/metrics-report.ts under the DIRECT role — so it can
 * answer "who exported this" for the operator, but it cannot back a consultant-visible access log
 * in the product. Doing that properly needs a first-class, org-scoped, consultant-readable export
 * log table; see the handoff note accompanying this work. Recording the event now means the history
 * exists to migrate when that table lands, instead of starting from empty.
 */
async function logReportExport(orgId: string, userId: string, reportId: string): Promise<void> {
  try {
    await withOrgScope(orgId, (tx: ScopedTx) => {
      const data = JSON.stringify({ reportId, userId, surface: "consultant_download" });
      return tx.$executeRaw`
        INSERT INTO "metric_events" (id, "orgId", type, data, "createdAt")
        VALUES (${randomUUID()}, ${orgId}, ${"report.exported"}, ${data}::jsonb, (now() AT TIME ZONE 'utc'))
      `;
    });
  } catch (err) {
    // Never fail the download over the log write: the consultant is mid-deal and the file is the
    // point. Logged loudly so a persistently broken trail is visible in the server logs.
    console.error("logReportExport failed:", err);
  }
}
