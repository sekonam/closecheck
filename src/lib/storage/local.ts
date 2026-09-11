import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Local-filesystem stand-in for the object storage docs/spec.md §10 calls for (encrypted at rest,
 * access-controlled per Engagement). Fine for local dev / this scaffold; swap for real object
 * storage (S3-compatible) before any real seller/buyer data touches this — do not ship this module
 * to production as-is. Every caller goes through `orgId` in the key path so a future S3 swap can
 * carry the same per-tenant prefixing straight over.
 */
const STORAGE_ROOT = join(process.cwd(), ".local-storage");

export async function putObject(key: string, data: Buffer): Promise<string> {
  const path = join(STORAGE_ROOT, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(join(STORAGE_ROOT, key));
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
