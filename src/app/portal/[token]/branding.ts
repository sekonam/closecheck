import { withOrgScope } from "@/lib/db/scoped";
import { getObject } from "@/lib/storage/local";

/**
 * The consultant's brand kit, for the portal chrome around a shared report.
 *
 * Why this exists: spec.md §2 principle 4 and §6 — the consultant's brand is what the buyer sees;
 * CloseCheck is infrastructure. A portal page wrapped in CloseCheck's own chrome hands a stranger a
 * report "from CloseCheck" containing the consultant's work, which is the one framing this product
 * is not allowed to produce.
 *
 * THE SNAPSHOT IS THE PRIMARY PATH; the org read is now only a fallback.
 * A Report is a point-in-time document (spec.md §6) whose PDF has the firm name, accent and logo
 * baked into it permanently, so generateReport records the same three values on the Report row
 * (`brandSnapshot*` — see prisma/schema.prisma). Branding a two-month-old report with whatever the
 * firm's branding happens to be today produced chrome that contradicted the document inside it, and
 * cost an org read on every buyer view to do so. When the snapshot is present this function does no
 * database work at all.
 *
 * The org read below survives only for Reports generated before that column existed. It is a
 * deliberate, narrow exception, and what keeps it safe is unchanged:
 * - `closecheck_portal` (src/lib/portal/db.ts) holds SELECT on `client_portal_links` and `reports`
 *   only, by design. Widening it to reach `consultant_orgs` would give the portal role a second
 *   table to be wrong about, so it is NOT widened here.
 * - Instead this reads the brand kit through the ordinary org-scoped path (`withOrgScope`, same RLS
 *   enforcement every consultant-facing read uses) — not a raw or admin connection.
 * - The orgId it scopes to is never taken from the request. It comes back from
 *   resolvePortalAccess, i.e. from a row the portal role's RLS policies returned only because a
 *   live, unrevoked, unexpired token matched. No token, no orgId, no call.
 * - It reads three whitelabel fields and nothing else. Findings, engagements and documents are not
 *   reachable from here, and the caller cannot pass in an arbitrary org.
 *
 * Fails soft: any error yields null and the page renders unbranded. A buyer must never get an error
 * page because a logo file went missing.
 */
export interface PortalBranding {
  orgName: string;
  accentHex: string | null;
  logoDataUri: string | null;
}

/**
 * The brand kit as it was when the Report was generated, straight off the Report row the portal
 * role already read (src/app/portal/[token]/access.ts) — no extra query, and no new grant: the
 * portal role's SELECT on `reports` is table-level, so these columns came with the row.
 */
export interface ReportBrandSnapshot {
  firmName: string | null;
  colorHex: string | null;
  logoKey: string | null;
}

// Mirrors src/app/api/branding/logo/route.ts's map, and deliberately excludes svg: an uploaded file's
// extension is not trustworthy, and an SVG inlined into the page could carry script. Anything
// unrecognized simply renders no logo.
const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Logos are brand marks, not artwork; anything past this is not inlined into the page. */
const MAX_INLINE_LOGO_BYTES = 512 * 1024;

export async function loadPortalBranding(
  orgId: string,
  snapshot?: ReportBrandSnapshot | null,
): Promise<PortalBranding | null> {
  // The firm name is the discriminator, not the logo or the colour: generateReport always records
  // it (ConsultantOrg.name is non-nullable), while the other two are legitimately null for a firm
  // that never set a brand kit. Its absence therefore means "generated before snapshots existed",
  // not "this firm has no branding" — and only the former should fall back to the live org row.
  if (snapshot?.firmName) {
    return {
      orgName: snapshot.firmName,
      accentHex: snapshot.colorHex,
      logoDataUri: await loadLogoDataUri(snapshot.logoKey),
    };
  }

  try {
    const org = await withOrgScope(orgId, (tx) =>
      tx.consultantOrg.findUnique({
        where: { id: orgId },
        select: { name: true, brandColorHex: true, brandLogoUrl: true },
      }),
    );
    if (!org) return null;

    return {
      orgName: org.name,
      accentHex: org.brandColorHex,
      logoDataUri: await loadLogoDataUri(org.brandLogoUrl),
    };
  } catch (err) {
    console.error("loadPortalBranding failed:", err);
    return null;
  }
}

async function loadLogoDataUri(storageKey: string | null): Promise<string | null> {
  if (!storageKey) return null;
  const contentType = EXTENSION_CONTENT_TYPE[storageKey.split(".").pop()?.toLowerCase() ?? ""];
  if (!contentType) return null;

  try {
    const bytes = await getObject(storageKey);
    if (bytes.length > MAX_INLINE_LOGO_BYTES) return null;
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    // Missing logo file (restored database, cleared volume) — render the firm's name alone.
    return null;
  }
}
