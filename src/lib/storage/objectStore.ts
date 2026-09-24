import { stat } from "node:fs/promises";
import {
  deleteObject as localDelete,
  deleteObjectIfPresent as localDeleteIfPresent,
  getObject as localGet,
  objectExists as localExists,
  putObject as localPut,
  listKeys as localListKeys,
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
  /**
   * Every key the backend holds, across all tenants. OPS ONLY — the request path never enumerates
   * storage, and this is deliberately not exposed through any org-scoped helper. It exists for the
   * orphan sweep: objects that no row names are invisible to everything that joins through rows,
   * including the retention purge, so the only way to find them is to ask the backend what it has
   * and subtract what the database knows about.
   */
  listKeys(): Promise<string[]>;
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
  listKeys: localListKeys,
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
  if (!cached) {
    refuseUnacknowledgedLocalStorageInProduction();
    cached = isS3Configured() ? createS3Backend() : localBackend;
  }
  return cached;
}

/**
 * Why this is a refusal and not a warning, and why it lives here rather than only at boot.
 *
 * It was a boot-time warning. That was defensible while render.yaml mounted a persistent disk:
 * "local disk in production" then meant a real volume, documents survived deploys, and the warning
 * was about encryption and redundancy — real gaps, but not data loss. The blueprint no longer
 * mounts a disk, because the founder chose Cloudflare R2 (2026-09-23). From that point on, a
 * production process that resolves to the local backend is writing seller contracts to the
 * container's ephemeral filesystem, and every one of them is gone on the next deploy.
 *
 * A warning in a boot log is the silent path for that. Nobody reads a boot log on a deploy that
 * came up green, uploads succeed, downloads succeed, and the loss is discovered by the first firm
 * to open a two-week-old audit after a redeploy. So the check moves to where the harm happens:
 * every storage operation resolves the backend through here, and in production with no object
 * storage configured and no explicit acknowledgement, resolution fails with the reason.
 *
 * The acknowledgement is what keeps the legitimate case legitimate. Local-on-a-mounted-volume is
 * still a supported configuration; an operator who has actually mounted one sets
 * STORAGE_ACKNOWLEDGE_LOCAL=true and says so on purpose. What is no longer possible is drifting
 * into ephemeral storage by leaving five variables unset.
 */
function refuseUnacknowledgedLocalStorageInProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (isS3Configured()) return;
  if (process.env.STORAGE_ACKNOWLEDGE_LOCAL === "true") return;
  throw new Error(
    `[storage] Refusing to use local disk in production (${localBackend.describe()}) without an ` +
      `explicit acknowledgement.\n` +
      `[storage] Without a mounted persistent volume that path is the container's ephemeral ` +
      `filesystem, and every uploaded document would be lost on the next deploy. Documents are ` +
      `meant to go to object storage: set STORAGE_S3_BUCKET, STORAGE_S3_ENDPOINT, STORAGE_S3_REGION, ` +
      `STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY (docs/deployment.md, "Object storage").\n` +
      `[storage] If that path really is a mounted persistent volume, set STORAGE_ACKNOWLEDGE_LOCAL=true. ` +
      `What a volume still does not give you: encryption at rest beyond what the volume provides, and ` +
      `redundancy — it is a single copy.`,
  );
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
/**
 * Every operation below is `async` even where it only forwards to the backend, so that a failure
 * to RESOLVE the backend — the production refusal of unacknowledged local disk — and a failure of
 * the tenancy guard both arrive as rejections. They used to throw synchronously out of a
 * Promise-returning function, which a caller chaining `.catch()` never sees and which the
 * `rejects` matcher in a test cannot observe either. A function that returns a promise should
 * fail through it.
 */
export async function putObject(
  orgId: string,
  key: string,
  data: Buffer,
  contentType?: string,
): Promise<void> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().put(key, data, contentType);
}
export async function getObject(orgId: string, key: string): Promise<Buffer> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().get(key);
}
export async function deleteObject(orgId: string, key: string): Promise<void> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().delete(key);
}
export async function objectExists(orgId: string, key: string): Promise<boolean> {
  assertKeyBelongsToOrg(orgId, key);
  return storageBackend().exists(key);
}

/**
 * Ops-only, cross-tenant by nature: every key in the backend. See StorageBackend.listKeys for why
 * this exists and why nothing in the request path may call it.
 */
export async function listAllObjectKeysAcrossOrgs(): Promise<string[]> {
  return storageBackend().listKeys();
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
export async function deleteObjectIfPresentAcrossOrgs(key: string): Promise<"deleted" | "missing"> {
  return storageBackend().deleteIfPresent(key);
}
export async function assertStorageUsable(): Promise<void> {
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
 * Boot-time report of the storage decision. Resolves the backend once so that a production
 * process which would be refused says so in its first lines of log, at error level, rather than
 * on its first upload — and so that a correctly configured one names where documents go.
 *
 * Logs rather than throws, deliberately: what Next does with an exception thrown from
 * instrumentation's register() has not been verified here, and the refusal does not depend on it —
 * storageBackend() enforces it on every operation. This is the early, visible copy of that
 * message, not the enforcement.
 */
export function reportStorageBackendAtBoot(): void {
  if (process.env.NODE_ENV !== "production") return;
  try {
    const backend = storageBackend();
    if (backend.kind === "local") {
      // Acknowledged local disk — the only way to get here. Say what it costs, once.
      console.warn(
        `[storage] Running in production on ${backend.describe()}, acknowledged via ` +
          `STORAGE_ACKNOWLEDGE_LOCAL. Encryption at rest is whatever the volume provides, and ` +
          `there is no redundancy — the volume is a single copy.`,
      );
    } else {
      console.log(`[storage] ${backend.describe()}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("[storage] Every upload, download and purge will fail until this is resolved.");
  }
}
