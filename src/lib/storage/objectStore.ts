import { stat } from "node:fs/promises";
import {
  deleteObject as localDelete,
  deleteObjectIfPresent as localDeleteIfPresent,
  getObject as localGet,
  objectExists as localExists,
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
   * Whether an object is there, WITHOUT reading it.
   *
   * Throws on anything that is not a definite not-found. That asymmetry is the whole design: the
   * caller is deciding whether to show a buyer their report or tell them it is unavailable, and
   * reporting a credentials or network failure as `false` would tell every buyer the report is
   * missing while it sits there readable. A confident false statement is worse than a visible
   * malfunction, and it is indistinguishable from the legitimate case.
   *
   * This exists because the portal page was resolving `storageRoot()` and calling `stat` itself.
   * Under an S3 configuration that returns a local directory, every check fails, and the portal
   * renders "the report isn't available" for every buyer on every link — silently, and looking
   * exactly like the feature working. The seam is only a seam if nobody reaches around it.
   */
  exists(key: string): Promise<boolean>;
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
  async exists(key) {
    // Goes through the local backend's own resolution, so the containment guard applies here too —
    // an existence probe with a traversing key must not be the one operation that escapes.
    return localExists(key);
  },
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

/**
 * Refuses a key that does not belong to this org.
 *
 * Every key this product generates begins with an orgId segment — `evidenceKey`, `reportPdfKey`
 * and `orgLogoKey` all build `${orgId}/...`. That prefix was a convention, and a convention is
 * something the code hopes for rather than something it enforces.
 *
 * It failed exactly as conventions do. `GET /api/evidence/[id]` read the Evidence row under
 * withOrgScope — the ROW was correctly scoped, and the route's comment said so — and then fetched
 * `evidence.storageKey` with nothing checking whose prefix it carried. A key is a bare string read
 * back out of the database; the containment guard refuses keys leaving the storage ROOT, and a key
 * under another tenant's prefix is comfortably inside it. Demonstrated against the running app: a
 * signed-in user of one firm received another firm's seller document, 200 and the bytes. That is
 * the failure spec.md §8 names as this product's core reputational risk.
 *
 * Latent, because the key builders always use the session's org, so the application cannot write a
 * crossed key today. "Unreachable through the application" is an argument that failed three times
 * in one day — a traversing storage key, a portal link naming one firm while its report belonged to
 * another, and this — and this is the one where it costs the most.
 *
 * Refuses rather than reconciles, like the containment guard: a key that disagrees with the org
 * asking for it describes a corrupt row, and the only safe reading of a corrupt row is that there
 * is nothing to serve.
 */
export function assertKeyBelongsToOrg(orgId: string, key: string): void {
  if (!orgId) throw new Error("Refusing a storage operation with no org scope.");
  if (key !== `${orgId}` && !key.startsWith(`${orgId}/`)) {
    throw new Error(
      `Refusing a storage key that does not belong to this org: ${key} is not under ${orgId}/`,
    );
  }
}

/**
 * The tenant-scoped storage API. The org is a required argument, deliberately — there is no
 * unscoped read or write to reach for by accident, which is the difference between a guard and an
 * alternative. `scripts/purge-expired-documents.ts` is the one legitimate cross-tenant caller and
 * uses the explicitly-named function at the bottom of this file, the same shape as
 * src/lib/db/scoped.ts naming that script as RLS's single documented exception.
 */
export function putObject(
  orgId: string,
  key: string,
  data: Buffer,
  contentType?: string,
): Promise<void> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().put(key, data, contentType);
}
export function getObject(orgId: string, key: string): Promise<Buffer> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().get(key);
}
export function deleteObject(orgId: string, key: string): Promise<void> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().delete(key);
}
export function objectExists(orgId: string, key: string): Promise<boolean> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().exists(key);
}

/**
 * Deletes without an org scope. The retention purge is the ONLY caller and the only legitimate one:
 * it walks every engagement whose documents are due across every org, so there is no single org to
 * scope it to, and it already runs on the superuser database role for exactly the same reason.
 *
 * Named so it cannot be reached for absent-mindedly. Anything serving a document to a person wants
 * getObject and its required org; if a new caller seems to want this, the question to ask is which
 * org it is acting for, not how to bypass the argument.
 */
export function deleteObjectIfPresentAcrossOrgs(key: string): Promise<"deleted" | "missing"> {
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
