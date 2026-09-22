import { stat } from "node:fs/promises";
import {
  deleteObject as localDelete,
  deleteObjectIfPresent as localDeleteIfPresent,
  getObject as localGet,
  putObject as localPut,
  storageRoot,
} from "./local";
import { createS3Backend, isS3Configured } from "./s3";

/**
 * The storage boundary every caller goes through (docs/spec.md §10).
 *
 * Until now `src/lib/storage/local.ts` WAS the storage layer, and it says in its own docstring not
 * to ship as-is — a local filesystem gives no encryption at rest beyond whatever the volume
 * provides, no redundancy, and on a container without a mounted disk it silently loses every
 * uploaded document on the next deploy. That made it the largest single gap in
 * docs/security-posture.md, and the one blocking a design partner putting real seller contracts
 * and merchant statements into the product.
 *
 * This is the seam that removes it. Local stays the default and is completely unchanged, so
 * development needs no configuration and nothing about today's behaviour moves. An S3-compatible
 * backend activates when it is configured, which makes the provider decision an endpoint and a
 * credential rather than a code change — S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and
 * MinIO all speak the same protocol, so building against it is not a commitment to any of them.
 *
 * WHY THE BACKENDS ENFORCE CONTAINMENT THEMSELVES rather than this module doing it once: a key is
 * not a path until a backend interprets it, and the two interpret it differently. Local resolves it
 * against a filesystem root, where `..` escapes; S3 treats it as an opaque object name, where the
 * same string is merely a strange key but can still land outside the tenant prefix that makes
 * per-org separation meaningful. One shared check would have to be the union of both rules and
 * would drift from whichever backend it did not belong to. So each refuses what it can actually
 * reason about, and neither trusts the caller to have sanitised the key — which matters because
 * keys are read back out of the database as bare strings, not only generated.
 */
export type StorageBackend = {
  readonly kind: "local" | "s3";
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Tolerates an already-missing object: the caller's goal is "this key no longer resolves". */
  delete(key: string): Promise<void>;
  /**
   * Deletes and reports which happened. Retention enforcement needs the distinction —
   * scripts/purge-expired-documents.ts must not destroy the only pointer to a document it failed to
   * find — so a backend that cannot tell the difference is not usable for that job.
   */
  deleteIfPresent(key: string): Promise<"deleted" | "missing">;
  /**
   * Fails unless the backend is actually usable right now: the directory exists, or the bucket
   * answers with these credentials.
   *
   * This generalises the pre-flight the retention purge already had. That check exists because a
   * misconfigured storage path made every unlink miss, every ENOENT read as "already purged", and
   * every Evidence row get deleted while the documents survived — a retention failure reporting a
   * clean run. The failure mode is identical against an unreachable bucket, so the guard has to
   * travel with the abstraction rather than staying behind as a filesystem detail.
   */
  assertUsable(): Promise<void>;
  /** One line naming the backend and where it points, for startup logs and the purge script. */
  describe(): string;
};

const localBackend: StorageBackend = {
  kind: "local",
  async put(key, data) {
    await localPut(key, data);
  },
  get: localGet,
  delete: localDelete,
  deleteIfPresent: localDeleteIfPresent,
  async assertUsable() {
    const root = storageRoot();
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) {
      throw new Error(
        `Storage root ${root} does not exist or is not a directory. Set STORAGE_ROOT_DIR to the ` +
          `volume this deployment actually writes to.`,
      );
    }
  },
  describe: () => `local filesystem at ${storageRoot()}`,
};

let cached: StorageBackend | null = null;

/**
 * The active backend. Resolved on first use rather than at module load so tests can reconfigure the
 * environment, and so importing this module never fails on a machine with no storage configured.
 */
export function storageBackend(): StorageBackend {
  if (!cached) cached = isS3Configured() ? createS3Backend() : localBackend;
  return cached;
}

/** Test seam: forces the next call to re-read configuration. */
export function resetStorageBackend(): void {
  cached = null;
}

export function putObject(key: string, data: Buffer, contentType?: string): Promise<void> {
  return storageBackend().put(key, data, contentType);
}
export function getObject(key: string): Promise<Buffer> {
  return storageBackend().get(key);
}
export function deleteObject(key: string): Promise<void> {
  return storageBackend().delete(key);
}
export function deleteObjectIfPresent(key: string): Promise<"deleted" | "missing"> {
  return storageBackend().deleteIfPresent(key);
}
export function assertStorageUsable(): Promise<void> {
  return storageBackend().assertUsable();
}
export function describeStorage(): string {
  return storageBackend().describe();
}

/**
 * Key helpers are backend-independent by design: the same key names the same document whichever
 * backend holds it, which is what makes a migration between them a copy rather than a rewrite.
 */
export { evidenceKey, orgLogoKey, reportPdfKey, storageRoot } from "./local";

/**
 * Warns when production is running on local disk.
 *
 * Deliberately a warning and not a refusal. Local-with-a-mounted-volume is the currently SUPPORTED
 * production configuration — render.yaml mounts a persistent disk and docs/deployment.md walks
 * through it — so refusing to boot would turn a working documented setup into a failure the first
 * time anyone deployed. What it cannot do is stay invisible, because the difference between "local
 * disk on a mounted volume" and "local disk on a container that resets every deploy" is every
 * document the firm has uploaded, and nothing in the running system says which one you have.
 *
 * STORAGE_ACKNOWLEDGE_LOCAL=true silences it — an explicit act rather than a default to drift into.
 */
export function warnIfProductionStorageIsLocal(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (storageBackend().kind !== "local") return;
  if (process.env.STORAGE_ACKNOWLEDGE_LOCAL === "true") return;

  // Names what is actually missing rather than warning generically. An operator who mounted the
  // volume correctly and then reads a warning implying they did not will either ignore it from
  // then on, or "fix" something that was already right. Persistence is solved by the mount; what
  // the mount cannot give is encryption at rest or redundancy.
  console.warn(
    `[storage] Running in production on ${describeStorage()}.\n` +
      `[storage] If that path is a mounted persistent volume, documents survive deploys and this ` +
      `is the supported configuration — no action needed beyond acknowledging it.\n` +
      `[storage] What it does not give you, either way: encryption at rest is whatever the volume ` +
      `provides rather than application-managed, and there is no redundancy — the volume is a ` +
      `single copy.\n` +
      `[storage] Configure STORAGE_S3_BUCKET for object storage, or set ` +
      `STORAGE_ACKNOWLEDGE_LOCAL=true once you have confirmed the mount.`,
  );
}
