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
    ListObjectsV2Command: class extends Cmd {},
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
  /**
   * The default is OFF. It was ON, and Cloudflare R2 — the provider actually chosen — rejects
   * `x-amz-server-side-encryption` on PutObject, so the default made the first upload fail.
   * AWS applies SSE-S3 to every new object automatically since 2023-01-05 and R2 encrypts at rest
   * unconditionally, so the header is not carrying the property on either provider.
   */
  it("is not requested by default", async () => {
    const store = await backend();
    send.mockResolvedValue({});
    await store.put("org1/evidence/f1/x.pdf", Buffer.from("x"), "application/pdf");
    expect(send.mock.calls[0][0].input.ServerSideEncryption).toBeUndefined();
  });

  it("is sent when explicitly asked for, for a bucket policy that demands it", async () => {
    process.env.STORAGE_S3_SSE = "AES256";
    const store = await backend();
    send.mockResolvedValue({});
    await store.put("org1/evidence/f1/x.pdf", Buffer.from("x"), "application/pdf");
    expect(send.mock.calls[0][0].input.ServerSideEncryption).toBe("AES256");
  });

  it("accepts an explicit none", async () => {
    process.env.STORAGE_S3_SSE = "none";
    const store = await backend();
    send.mockResolvedValue({});
    await store.put("org1/evidence/f1/x.pdf", Buffer.from("x"));
    expect(send.mock.calls[0][0].input.ServerSideEncryption).toBeUndefined();
  });

  /**
   * The old test was `=== "none" ? off : on`, which read every other string as "on" — so
   * STORAGE_S3_SSE=off turned encryption ON, the exact opposite of what the operator wrote, with
   * nothing reporting it. A setting whose purpose is to be read back later and believed must not
   * have a spelling that silently means its own negation.
   */
  it.each(["off", "false", "disabled", "AES-256", "aes 256", "sse-c", "true", "1"])(
    "refuses the unrecognised value %j rather than guessing",
    async (value) => {
      process.env.STORAGE_S3_SSE = value;
      const store = await backend();
      send.mockResolvedValue({});
      await expect(
        store.put("org1/evidence/f1/x.pdf", Buffer.from("x")),
      ).rejects.toThrow(/not a value this understands/);
    },
  );

  it("is case- and whitespace-tolerant for the two values it does accept", async () => {
    process.env.STORAGE_S3_SSE = " aes256 ";
    const store = await backend();
    send.mockResolvedValue({});
    await store.put("org1/evidence/f1/x.pdf", Buffer.from("x"));
    expect(send.mock.calls[0][0].input.ServerSideEncryption).toBe("AES256");
  });
});

describe("exists distinguishes absence from not knowing", () => {
  /**
   * The caller is the client portal deciding whether to show a buyer their report or tell them it
   * is unavailable. Reporting a credentials or network failure as `false` would tell every buyer
   * the report is missing while it sits in the bucket readable — a confident false statement, and
   * indistinguishable from the legitimate case.
   */
  it("is true when the object is there", async () => {
    const store = await backend();
    send.mockResolvedValue({});
    expect(await store.exists("org1/reports/r1.pdf")).toBe(true);
  });

  it("is false only for a definite not-found", async () => {
    const store = await backend();
    send.mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" }));
    expect(await store.exists("org1/reports/r1.pdf")).toBe(false);

    send.mockRejectedValueOnce(Object.assign(new Error("nope"), { $metadata: { httpStatusCode: 404 } }));
    expect(await store.exists("org1/reports/r1.pdf")).toBe(false);
  });

  it("throws rather than claiming absence when it cannot tell", async () => {
    const store = await backend();
    for (const failure of [
      Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }),
      Object.assign(new Error("SlowDown"), { $metadata: { httpStatusCode: 503 } }),
      new Error("socket hang up"),
    ]) {
      send.mockRejectedValueOnce(failure);
      await expect(store.exists("org1/reports/r1.pdf")).rejects.toThrow();
    }
  });

  it("refuses an out-of-prefix key before asking", async () => {
    const store = await backend();
    await expect(store.exists("../escape.pdf")).rejects.toThrow(/not a plain relative/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("listObjects", () => {
  /**
   * The orphan sweep subtracts what the database names from what the backend holds. A listing that
   * stopped at the first page would make it report a clean bucket that was not — and a bucket of
   * seller documents outgrows one page quickly — so pagination is the property under test.
   */
  it("follows continuation tokens until the listing is complete, and sorts", async () => {
    const store = await backend();
    const t = new Date("2026-09-24T08:00:00Z");
    send
      .mockResolvedValueOnce({ Contents: [{ Key: "org2/b.pdf", LastModified: t }, { Key: "org1/a.pdf", LastModified: t }], IsTruncated: true, NextContinuationToken: "t1" })
      .mockResolvedValueOnce({ Contents: [{ Key: "org1/c.pdf", LastModified: t }], IsTruncated: false });
    expect(await store.listObjects()).toEqual([
      { key: "org1/a.pdf", lastModified: t },
      { key: "org1/c.pdf", lastModified: t },
      { key: "org2/b.pdf", lastModified: t },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "closecheck-test" });
    expect(send.mock.calls[1][0].input).toMatchObject({ Bucket: "closecheck-test", ContinuationToken: "t1" });
  });

  it("returns an empty list for an empty bucket rather than throwing", async () => {
    const store = await backend();
    send.mockResolvedValueOnce({ IsTruncated: false });
    expect(await store.listObjects()).toEqual([]);
  });

  it("treats an object with no LastModified as brand new, so an age threshold keeps it", async () => {
    const store = await backend();
    const before = Date.now();
    send.mockResolvedValueOnce({ Contents: [{ Key: "org1/x.pdf" }], IsTruncated: false });
    const [o] = await store.listObjects();
    expect(o.lastModified.getTime()).toBeGreaterThanOrEqual(before);
  });
});
