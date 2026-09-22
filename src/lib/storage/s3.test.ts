import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The half of the S3 backend where a bug would be OURS.
 *
 * Nothing here contacts a bucket, and that is deliberate rather than a limitation being worked
 * around. SigV4 signing, retries and checksums are the SDK's job — which is the reason for taking
 * the dependency at all — and a fake endpoint that happily accepted our signatures would prove
 * nothing about whether a real one would. What these cover is the code we wrote: which keys are
 * refused before any request is issued, and whether a missing object is reported as missing rather
 * than as a failure, which is the distinction the retention purge depends on to avoid destroying
 * the only pointer to a document it could not find.
 */
const send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = send;
    },
    PutObjectCommand: class extends Cmd {},
    GetObjectCommand: class extends Cmd {},
    DeleteObjectCommand: class extends Cmd {},
    HeadObjectCommand: class extends Cmd {},
    HeadBucketCommand: class extends Cmd {},
  };
});

const SAVED = { ...process.env };

async function backend() {
  const mod = await import("./s3");
  mod.resetS3Client();
  return mod.createS3Backend();
}

beforeEach(() => {
  send.mockReset();
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("STORAGE_")) delete process.env[key];
  }
  process.env.STORAGE_S3_BUCKET = "closecheck-test";
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("isS3Configured", () => {
  it("is configured exactly when a bucket is named", async () => {
    const mod = await import("./s3");
    expect(mod.isS3Configured()).toBe(true);
    delete process.env.STORAGE_S3_BUCKET;
    expect(mod.isS3Configured()).toBe(false);
  });
});

describe("key containment", () => {
  /**
   * S3 has no filesystem to escape, so this is the same property one layer up. Every key this
   * product generates starts with an orgId segment, and that prefix is what makes per-tenant
   * separation legible in the bucket and what any bucket policy or lifecycle rule would be written
   * against. A key with `..` or a leading slash still lands somewhere — just outside that scheme,
   * silently. Keys arrive from the database as bare strings, so no generator can be assumed.
   */
  const REFUSED = [
    "",
    "/absolute/key.pdf",
    "../escape.pdf",
    "org/../../escape.pdf",
    "org/./same.pdf",
    "org//double-slash.pdf",
    "org\\windows\\style.pdf",
  ];

  it("refuses a key that is not a plain relative object name, before any request", async () => {
    const store = await backend();
    for (const key of REFUSED) {
      await expect(store.get(key), key).rejects.toThrow(/not a plain relative object name/);
    }
    expect(send, "a refused key must never reach the client").not.toHaveBeenCalled();
  });

  it("refuses on every operation, not just reads", async () => {
    const store = await backend();
    const key = "../escape.pdf";
    await expect(store.put(key, Buffer.from("x"))).rejects.toThrow(/not a plain relative/);
    await expect(store.delete(key)).rejects.toThrow(/not a plain relative/);
    await expect(store.deleteIfPresent(key)).rejects.toThrow(/not a plain relative/);
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts the keys this product actually generates", async () => {
    const { evidenceKey, reportPdfKey, orgLogoKey } = await import("./local");
    const store = await backend();
    send.mockResolvedValue({});
    for (const key of [
      evidenceKey("org1", "finding1", "ev1", "Toast MSA.pdf"),
      reportPdfKey("org1", "report1"),
      orgLogoKey("org1", "logo.png"),
    ]) {
      await expect(store.delete(key), key).resolves.toBeUndefined();
    }
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("deleteIfPresent reports missing rather than failing", () => {
  /**
   * The retention purge depends on this distinction: a document it cannot find must keep its
   * database row, because that row is the only remaining pointer to it. A backend that reported
   * "missing" as an error, or worse as success, would reintroduce the exact data-loss bug that
   * rule exists to prevent.
   */
  it("returns missing for a 404 from HEAD, without issuing a delete", async () => {
    const store = await backend();
    send.mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" }));
    expect(await store.deleteIfPresent("org1/evidence/f1/x.pdf")).toBe("missing");
    expect(send, "nothing should be deleted when the object was not found").toHaveBeenCalledTimes(1);
  });

  it("treats an SDK 404 status the same as a named NotFound", async () => {
    const store = await backend();
    send.mockRejectedValueOnce(Object.assign(new Error("nope"), { $metadata: { httpStatusCode: 404 } }));
    expect(await store.deleteIfPresent("org1/evidence/f1/x.pdf")).toBe("missing");
  });

  it("returns deleted when the object is there, and issues the delete", async () => {
    const store = await backend();
    send.mockResolvedValue({});
    expect(await store.deleteIfPresent("org1/evidence/f1/x.pdf")).toBe("deleted");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("propagates a real failure instead of calling it missing", async () => {
    // Permission denied is not absence. Reporting it as "missing" would let the purge delete the
    // row for a document that is present and merely unreadable.
    const store = await backend();
    send.mockRejectedValueOnce(Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }));
    await expect(store.deleteIfPresent("org1/evidence/f1/x.pdf")).rejects.toThrow(/AccessDenied/);
  });
});

describe("assertUsable", () => {
  it("passes when the bucket answers", async () => {
    const store = await backend();
    send.mockResolvedValue({});
    await expect(store.assertUsable()).resolves.toBeUndefined();
  });

  it("fails with a message naming the bucket when it does not", async () => {
    const store = await backend();
    send.mockRejectedValue(new Error("NoSuchBucket"));
    await expect(store.assertUsable()).rejects.toThrow(/closecheck-test/);
    await expect(store.assertUsable()).rejects.toThrow(/NoSuchBucket/);
  });
});

describe("server-side encryption", () => {
  it("is requested by default", async () => {
    const store = await backend();
    send.mockResolvedValue({});
    await store.put("org1/evidence/f1/x.pdf", Buffer.from("x"), "application/pdf");
    expect(send.mock.calls[0][0].input.ServerSideEncryption).toBe("AES256");
  });

  it("can be turned off for a backend that rejects the header", async () => {
    process.env.STORAGE_S3_SSE = "none";
    const store = await backend();
    send.mockResolvedValue({});
    await store.put("org1/evidence/f1/x.pdf", Buffer.from("x"));
    expect(send.mock.calls[0][0].input.ServerSideEncryption).toBeUndefined();
  });
});
