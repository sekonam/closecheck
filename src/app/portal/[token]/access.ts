import { createHash, randomUUID } from "node:crypto";
import type { PortalAccessKind } from "@prisma/client";
import { clientAddressFrom } from "@/lib/api/rateLimit";
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
 * spec.md §8: "who viewed/exported/shared a given Report and when."
 *
 * A row is written for EVERY access. Nothing the caller controls decides whether one exists — an
 * earlier version let the PDF route suppress logging when it saw `Sec-Fetch-Dest: iframe`, to
 * avoid double-counting the embedded viewer's own fetch. That header is forbidden to browser
 * scripts and entirely free for anything else, so sending it erased the trail: ten complete
 * downloads, and the consultant's audit page read "never viewed". The page-and-its-own-viewer pair
 * is now collapsed when the trail is SUMMARISED, where getting it wrong costs a display artefact
 * rather than the evidence.
 */
export async function resolvePortalAccess(
  token: string,
  options: { log: boolean; kind?: PortalAccessKind; headers?: Headers } = { log: true },
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
      // Through the shared address parser, not the raw header. Reading `x-forwarded-for` and
      // taking its first element meant the value was whatever the client sent — most proxies
      // APPEND, so the leftmost hop is the caller's own. Forty requests from one machine rendered
      // to the consultant as "viewed 40 times — 40 origins", and `X-Forwarded-For:
      // not-an-ip-at-all` was hashed and stored verbatim. `clientAddressFrom` counts hops from the
      // right against TRUSTED_PROXY_HOPS and refuses to guess when fewer are present than
      // configured.
      const address = options.headers
        ? clientAddressFrom({ headers: options.headers } as Request)
        : "unknown";
      // "unknown" is a real answer and must not masquerade as an address: it is what every caller
      // resolves to when the deployment has no trusted proxy, and hashing it would make them all
      // look like one identified viewer.
      const ipHash =
        address === "unknown" ? null : createHash("sha256").update(address).digest("hex");
      const kind: PortalAccessKind = options.kind ?? "PAGE";
      await tx.$executeRaw`
        INSERT INTO "portal_access_log" (id, "linkId", "viewedAt", "kind", "ipHash")
        VALUES (${randomUUID()}, ${link.id}, (now() AT TIME ZONE 'utc'), ${kind}::"PortalAccessKind", ${ipHash})
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
