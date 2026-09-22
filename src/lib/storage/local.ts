import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Local-filesystem stand-in for the object storage docs/spec.md §10 calls for (encrypted at rest,
 * access-controlled per Engagement). Fine for local dev / this scaffold; swap for real object
 * storage (S3-compatible) before any real seller/buyer data touches this — do not ship this module
 * to production as-is. Every caller goes through `orgId` in the key path so a future S3 swap can
 * carry the same per-tenant prefixing straight over.
 *
 * STORAGE_ROOT_DIR overrides the default cwd-relative path — needed in production so this can point
 * at a mounted persistent volume instead of the container's (ephemeral, per-deploy) filesystem. Unset
 * in local dev, matching the previous hardcoded behavior.
 */
const STORAGE_ROOT = process.env.STORAGE_ROOT_DIR || join(process.cwd(), ".local-storage");

export async function putObject(key: string, data: Buffer): Promise<string> {
  const path = join(STORAGE_ROOT, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(join(STORAGE_ROOT, key));
}

/** Tolerates an already-missing file (e.g. a re-run, or a key that was never actually written) —
 * the caller's goal ("this key no longer points to a live file") is already satisfied either way. */
export async function deleteObject(key: string): Promise<void> {
  await unlink(join(STORAGE_ROOT, key)).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
}

/**
 * The resolved storage root. Exported so other entry points (notably
 * scripts/purge-expired-documents.ts, which runs outside the Next app) resolve the same directory
 * this module writes to instead of recomputing it. They are not free to diverge: a purge script
 * that computed its own cwd-relative root deleted Evidence rows while their files sat untouched
 * under STORAGE_ROOT_DIR, and reported success — a spec.md §8 retention failure that looked like a
 * clean run. One definition, one place.
 */
export function storageRoot(): string {
  return STORAGE_ROOT;
}

/**
 * Like deleteObject, but reports whether the file was actually there. Retention enforcement needs
 * that distinction: deleteObject's ENOENT tolerance is right for a caller whose goal is "this key
 * no longer points to a live file", and wrong for one that must not destroy the only pointer to a
 * document it failed to find.
 */
export async function deleteObjectIfPresent(key: string): Promise<"deleted" | "missing"> {
  try {
    await unlink(join(STORAGE_ROOT, key));
    return "deleted";
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return "missing";
    throw err;
  }
}

export function reportPdfKey(orgId: string, reportId: string): string {
  return `${orgId}/reports/${reportId}.pdf`;
}

/** Sanitizes the original filename for use as a path segment — keeps it human-readable in the key
 * without letting it escape the intended directory. */
export function evidenceKey(orgId: string, findingId: string, evidenceId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "file";
  return `${orgId}/evidence/${findingId}/${evidenceId}-${safeName}`;
}

/** One logo per org, but the key still incorporates the (sanitized) original filename — so a
 * re-upload under a different filename/extension does NOT land at the same path. Callers that
 * replace or clear a logo must explicitly delete the previous key themselves (see
 * uploadOrgLogo/removeOrgLogo in src/lib/actions/org.ts); this helper alone does not prevent
 * orphaning the prior file. */
export function orgLogoKey(orgId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "logo";
  return `${orgId}/branding/logo-${safeName}`;
}
