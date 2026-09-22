import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { StorageBackend } from "./objectStore";

/**
 * S3-compatible object storage (docs/spec.md §10: "encrypted at rest, access-controlled per
 * Engagement").
 *
 * Written against the S3 protocol rather than a named provider, because that protocol is what AWS
 * S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and MinIO all speak. Choosing between them
 * is then an endpoint and a credential, which is a decision the founder can make later without
 * anyone touching code — the point of building this before the provider is picked.
 *
 * STATUS: IMPLEMENTED, NOT YET EXERCISED AGAINST A REAL ENDPOINT. Nothing here has run against a
 * live bucket — no credentials exist yet, and the sandbox has no container runtime to host a local
 * MinIO. What IS covered by tests is the half where a bug would be ours: key containment refusing
 * an out-of-prefix key before any request is issued, the pre-flight refusing an unreachable bucket,
 * and error mapping treating a missing object as missing rather than as failure. SigV4 correctness
 * is the SDK's job, which is the reason for taking the dependency; a fake endpoint that accepted
 * our signatures would prove nothing about it.
 *
 * This paragraph comes out the first time someone points it at a bucket and round-trips a file —
 * upload, read, purge. That is a five-minute exit criterion, not a project, and until it happens
 * "we support S3" and "we have written S3 support nobody has run" are different claims.
 *
 * `@aws-sdk/client-s3` rather than a hand-rolled signer: SigV4 is security-adjacent code whose
 * failures are silent and total, and this stores sellers' executed contracts and merchant
 * statements. The image already carries a full Chromium for PDF rendering, so the size argument
 * against the SDK is weak.
 */

/** Configured means a bucket is named. Everything else has a defensible default or is supplied by
 * the provider's own credential chain. */
export function isS3Configured(): boolean {
  return !!process.env.STORAGE_S3_BUCKET;
}

function bucket(): string {
  const name = process.env.STORAGE_S3_BUCKET;
  if (!name) throw new Error("STORAGE_S3_BUCKET is not set.");
  return name;
}

export function s3BackendDescription(): string {
  const endpoint = process.env.STORAGE_S3_ENDPOINT;
  return `S3-compatible bucket ${bucket()}${endpoint ? ` at ${endpoint}` : ""}`;
}

/**
 * Server-side encryption, on by default.
 *
 * This is PROVIDER-managed, not application-managed: the provider holds the key and can therefore
 * decrypt. It closes the "documents sit in plaintext on a volume" hole and does NOT close
 * docs/security-posture.md §4's "no application-managed encryption at rest", which needs a
 * key-management decision nobody has made. Recorded precisely rather than generously, because
 * overstating a control in a posture document is worse than omitting one.
 *
 * Set STORAGE_S3_SSE=none for a backend that rejects the header (some MinIO configurations).
 */
function serverSideEncryption(): "AES256" | undefined {
  return process.env.STORAGE_S3_SSE === "none" ? undefined : "AES256";
}

/**
 * Refuses a key that is not a plain, relative, multi-segment object name.
 *
 * S3 has no filesystem to escape, so this is not traversal defence in the local sense — it is the
 * same property one layer up. Every key this product generates begins with an orgId segment
 * (`evidenceKey`, `reportPdfKey`, `orgLogoKey`), and that prefix is what makes per-tenant
 * separation legible in the bucket and what any future bucket policy or lifecycle rule would be
 * written against. A key containing `..` or a leading slash still lands somewhere — it just lands
 * outside that scheme, silently, where nothing is watching.
 *
 * Applied here and not at the shared layer because a key is not a path until a backend interprets
 * it, and local and S3 interpret it differently. Keys arrive from the database as bare strings, so
 * neither backend may assume a generator produced them.
 */
function assertPlainKey(key: string): void {
  const invalid =
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (invalid) {
    throw new Error(`Refusing to use a storage key that is not a plain relative object name: ${key}`);
  }
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const config: S3ClientConfig = {
    region: process.env.STORAGE_S3_REGION || "auto",
  };
  const endpoint = process.env.STORAGE_S3_ENDPOINT;
  if (endpoint) config.endpoint = endpoint;
  // MinIO and some self-hosted gateways cannot do virtual-host-style addressing.
  if (process.env.STORAGE_S3_FORCE_PATH_STYLE === "true") config.forcePathStyle = true;

  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY;
  // Explicit credentials when given; otherwise fall through to the SDK's own chain, which is how
  // an instance role or a mounted credentials file is meant to work.
  if (accessKeyId && secretAccessKey) config.credentials = { accessKeyId, secretAccessKey };

  client = new S3Client(config);
  return client;
}

/** Test seam, mirroring resetStorageBackend. */
export function resetS3Client(): void {
  client = null;
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  const status = "$metadata" in err ? (err.$metadata as { httpStatusCode?: number })?.httpStatusCode : undefined;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

export function createS3Backend(): StorageBackend {
  return {
    kind: "s3",

    async put(key, data, contentType) {
      assertPlainKey(key);
      await s3().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: data,
          ContentType: contentType,
          ServerSideEncryption: serverSideEncryption(),
        }),
      );
    },

    async get(key) {
      assertPlainKey(key);
      const response = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      if (!response.Body) throw new Error(`Empty body for storage key ${key}`);
      // transformToByteArray buffers the whole object, matching the local backend's contract. Every
      // caller here reads a whole document and hands it to a response; nothing streams today, and a
      // streaming variant should be a separate method rather than a different return type.
      return Buffer.from(await response.Body.transformToByteArray());
    },

    async exists(key) {
      assertPlainKey(key);
      try {
        await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
        return true;
      } catch (err) {
        // ONLY a definite not-found is absence. A throttle, an expired credential or a network
        // failure reported as `false` would tell every buyer their report is missing while it sits
        // in the bucket readable — a confident false statement, and indistinguishable from the
        // legitimate case. Anything indeterminate propagates so the caller can decide.
        if (isNotFound(err)) return false;
        throw err;
      }
    },

    async delete(key) {
      assertPlainKey(key);
      // S3 DELETE is idempotent and succeeds for a key that was never there, which is exactly this
      // method's contract.
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    },

    async deleteIfPresent(key) {
      assertPlainKey(key);
      // HEAD first, because S3's DELETE cannot tell us whether anything was removed and retention
      // enforcement depends on that distinction: a purge must never delete the database row that is
      // the only pointer to a document it failed to find. The race between HEAD and DELETE is
      // acceptable here — the only writer to a given key is this application, and a key is written
      // once at upload and never rewritten.
      try {
        await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      } catch (err) {
        if (isNotFound(err)) return "missing";
        throw err;
      }
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
      return "deleted";
    },

    async assertUsable() {
      try {
        await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
      } catch (err) {
        throw new Error(
          `${s3BackendDescription()} is not reachable with the configured credentials: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    describe: s3BackendDescription,
  };
}
