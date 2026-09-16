"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { putObject, deleteObject, orgLogoKey } from "@/lib/storage/local";

// Raster only — deliberately excludes SVG. An uploaded SVG can carry a <script>, and
// /api/branding/logo serves it back with Content-Type: image/svg+xml; browsers don't execute that
// when it's used as an <img> src (how the settings page and report render it today), but the route
// itself doesn't stop someone from navigating to it directly, which does execute it. Not worth the
// risk for a whitelabel logo when PNG/JPEG/WebP/GIF cover every real case.
const ALLOWED_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const updateOrgBrandingSchema = z.object({
  name: z.string().min(1, "Org name is required"),
  // Blank clears the override back to the default accent used in src/lib/reports/renderHtml.ts —
  // same "blank means clear" convention as updateEngagement in src/lib/actions/engagements.ts.
  brandColorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #0f172a")
    .optional()
    .or(z.literal("")),
});

/** ConsultantOrg is itself tenant-owned data — a consultant can only ever edit their own org row,
 * enforced the same way as every other tenant table, via withOrgScope. */
export async function updateOrgBranding(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const parsed = updateOrgBrandingSchema.parse({
    name: formData.get("name"),
    brandColorHex: formData.get("brandColorHex") || "",
  });

  await withOrgScope(orgId, (tx) =>
    tx.consultantOrg.update({
      where: { id: orgId },
      data: {
        name: parsed.name,
        brandColorHex: parsed.brandColorHex || null,
      },
    }),
  );

  revalidatePath("/settings");
}

/**
 * Uploads the org's whitelabel logo (docs/spec.md §6). One logo per org conceptually, but
 * orgLogoKey's path includes the (sanitized) original filename, so a re-upload under a different
 * filename/extension does not land at the same key — explicitly deletes the previous key below
 * rather than relying on the new write to overwrite it in place.
 */
export async function uploadOrgLogo(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgSession();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    // Nothing selected — same no-op convention as attachEvidence in src/lib/actions/evidence.ts.
    return;
  }

  if (!ALLOWED_LOGO_MIME_TYPES.has(file.type)) {
    throw new Error(`Unsupported logo file type "${file.type || "unknown"}" — use PNG, JPEG, WebP, or GIF.`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const key = orgLogoKey(orgId, file.name);

  // Write the file first here (unlike attachEvidence/generateReport's commit-then-write ordering):
  // the only failure mode if the DB update below doesn't land is the old logo (or none) staying
  // referenced, not a dangling reference to a file that doesn't exist.
  await putObject(key, bytes);

  const previousKey = await withOrgScope(orgId, async (tx) => {
    const previous = await tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId }, select: { brandLogoUrl: true } });
    await tx.consultantOrg.update({ where: { id: orgId }, data: { brandLogoUrl: key } });
    return previous.brandLogoUrl;
  });

  // Best-effort: the new logo is already live either way, so a cleanup failure here shouldn't
  // surface as an error to the consultant — it just leaves one stale file behind.
  if (previousKey && previousKey !== key) {
    await deleteObject(previousKey).catch(() => {});
  }

  revalidatePath("/settings");
}

/**
 * Records that this org's consultant has read and approved the standard report disclaimer language
 * (spec.md §6 — "required review by the consultant, not optional boilerplate ... silently inserted").
 * generateReport (src/lib/actions/reports.ts) refuses to run until this is set. There's no
 * un-acknowledge action: the only way this field goes back to null is a future wording change
 * resetting it via migration (see the schema comment on ConsultantOrg.disclaimerAcknowledgedAt).
 */
export async function acknowledgeDisclaimer(): Promise<void> {
  const { orgId } = await requireOrgSession();

  await withOrgScope(orgId, (tx) =>
    tx.consultantOrg.update({ where: { id: orgId }, data: { disclaimerAcknowledgedAt: new Date() } }),
  );

  revalidatePath("/settings");
}

export async function removeOrgLogo(): Promise<void> {
  const { orgId } = await requireOrgSession();

  const previousKey = await withOrgScope(orgId, async (tx) => {
    const previous = await tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId }, select: { brandLogoUrl: true } });
    await tx.consultantOrg.update({ where: { id: orgId }, data: { brandLogoUrl: null } });
    return previous.brandLogoUrl;
  });

  if (previousKey) {
    await deleteObject(previousKey).catch(() => {});
  }

  revalidatePath("/settings");
}
