import { createHash, randomUUID } from "node:crypto";
import { withPortalScope } from "@/lib/portal/db";
import type { ReportBrandSnapshot } from "./branding";

/**
 * Shared token resolution for the two halves of the public Client Portal (spec.md §7): the page a
 * buyer opens, and the route that serves the report bytes to it. Both MUST go through exactly the
 * same door — `withPortalScope`, whose RLS policies
 * (prisma/migrations/20260918100100_portal_role) refuse to return a link that is missing, revoked or
 * expired, and whose role holds SELECT on `client_portal_links`/`reports` and nothing else.
 *
 * Splitting the PDF onto its own URL is the moment that guarantee is easiest to lose: a route that
 * resolved the report through the app role, or that trusted a reportId from the query string, would
 * hand any visitor any org's report. It is a separate file, not a separate access path — the
 * function below is the only way either half resolves anything.
 */
export interface PortalAccess {
  linkId: string;
  reportId: string;
  orgId: string;
  pdfStorageKey: string | null;
  /** The brand kit as of this Report's generation — see branding.ts. Carried on the access result
   * because it rides along on the `reports` row this function already reads; null firmName means a
   * Report generated before the snapshot columns existed. */
  brandSnapshot: ReportBrandSnapshot;
}

/**
 * spec.md §8: "who viewed/exported/shared a given Report and when." An access row is written for
 * every human access, which includes a direct hit on the PDF URL (someone forwarded the link, or
 * saved the file) — see the note on `skipLog` for why the embedded viewer's own fetch is the one
 * request that does not produce a second row.
 */
export async function resolvePortalAccess(
  token: string,
  options: { log: boolean; forwardedFor?: string | null } = { log: true },
): Promise<PortalAccess | null> {
  if (!token) return null;

  return withPortalScope(token, async (tx) => {
    const link = await tx.clientPortalLink.findFirst({ where: { token } });
    if (!link) return null;

    const report = await tx.report.findFirst({ where: { id: link.reportId } });
    if (!report) return null;

    if (options.log) {
      // Raw INSERT, not portalAccessLogEntry.create(): closecheck_portal has no SELECT grant on
      // portal_access_log (see src/lib/portal/db.ts's docstring and
      // scripts/verify-signup-portal-roles.ts), and Postgres requires SELECT to honor the RETURNING
      // clause create() always uses.
      const ipHash = options.forwardedFor
        ? createHash("sha256").update(options.forwardedFor.split(",")[0].trim()).digest("hex")
        : null;
      await tx.$executeRaw`
        INSERT INTO "portal_access_log" (id, "linkId", "viewedAt", "ipHash")
        VALUES (${randomUUID()}, ${link.id}, (now() AT TIME ZONE 'utc'), ${ipHash})
      `;
    }

    return {
      linkId: link.id,
      reportId: report.id,
      orgId: link.orgId,
      pdfStorageKey: report.pdfStorageKey,
      brandSnapshot: {
        firmName: report.brandSnapshotFirmName,
        colorHex: report.brandSnapshotColorHex,
        logoKey: report.brandSnapshotLogoKey,
      },
    };
  });
}
