import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * What the S3 backend actually puts on the wire, with NOTHING mocked.
 *
 * The justification for this file was wrong twice before it was right, which is worth recording
 * because the wrong versions were plausible. I first claimed a mocked suite could not catch a
 * mis-spelled `ServerSideEncryption` — it can, because s3.test.ts asserts on that exact input
 * field. I then claimed it could not catch a broken `forcePathStyle` — neither suite catches that,
 * because the SDK uses path-style against an IP endpoint regardless, so the assertion I thought was
 * discriminating is inert in this environment.
 *
 * What this file demonstrably catches and the mocked suite demonstrably does not: an input the SDK
 * itself rejects. Omitting a required field — `Key` on a PutObject, say — leaves a mock perfectly
 * happy, because a mock records whatever object it is handed and has no opinion about it. The real
 * client fails at serialization. So the property under test is narrow and real: **the inputs this
 * module constructs are ones the SDK will actually send**, which is exactly the class of defect an
 * unexercised backend hides until the first real request.
 *
 * It is NOT a claim that the backend works against S3. A listener answering 200 to anything proves
 * nothing about SigV4 being correct, and nothing at all about bucket semantics or error codes. The
 * "not yet exercised against a real endpoint" caveat s3.ts carried stood until someone pointed it at a
 * bucket.
 */
describe("the S3 backend's requests, unmocked", () => {
  let server: Server;
  let requests: { method: string; url: string; headers: Record<string, string | string[] | undefined> }[];

  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push({ method: req.method!, url: req.url!, headers: req.headers });
      req.resume();
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end('<?xml version="1.0"?><Result/>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    process.env.STORAGE_S3_BUCKET = "closecheck-docs";
    process.env.STORAGE_S3_REGION = "auto";
    process.env.STORAGE_S3_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.STORAGE_S3_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "secret";
    process.env.STORAGE_S3_FORCE_PATH_STYLE = "true";
    delete process.env.STORAGE_S3_SSE;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("STORAGE_S3_")) delete process.env[key];
    }
  });

  async function store() {
    const mod = await import("./s3");
    mod.resetS3Client();
    return mod.createS3Backend();
  }

  it("puts the object at bucket/key, signed, with the encryption header actually present", async () => {
    // Opt in explicitly: the default is now OFF, because Cloudflare R2 rejects this header and
    // neither R2 nor AWS needs it to encrypt at rest. This test still earns its place — it is the
    // one that proves the SDK parameter becomes a real wire header when it IS asked for, which is
    // what a bucket policy demanding the header depends on.
    process.env.STORAGE_S3_SSE = "AES256";
    await (await store()).put("org1/evidence/f1/Toast_MSA.pdf", Buffer.from("%PDF-1.4"), "application/pdf");

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PUT");
    // Path-style: bucket first, then the key verbatim. A key mangled in transit would show here.
    expect(req.url).toContain("/closecheck-docs/org1/evidence/f1/Toast_MSA.pdf");
    expect(String(req.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
    // The assertion mocks cannot make: the parameter became a real header on a real request.
    expect(req.headers["x-amz-server-side-encryption"]).toBe("AES256");
    expect(req.headers["content-type"]).toBe("application/pdf");
  });

  it("omits the encryption header by default, which is what R2 requires", async () => {
    delete process.env.STORAGE_S3_SSE;
    await (await store()).put("org1/evidence/f1/x.pdf", Buffer.from("x"));
    expect(requests[0].headers["x-amz-server-side-encryption"]).toBeUndefined();
  });

  it("omits it for an explicit none too", async () => {
    process.env.STORAGE_S3_SSE = "none";
    await (await store()).put("org1/evidence/f1/x.pdf", Buffer.from("x"));
    expect(requests[0].headers["x-amz-server-side-encryption"]).toBeUndefined();
  });

  it("checks the bucket rather than an object in the pre-flight", async () => {
    await (await store()).assertUsable();
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("HEAD");
    // The bucket itself, not a key under it — a pre-flight that HEADed an object would report a
    // perfectly good bucket as unusable whenever that object happened not to exist.
    expect(requests[0].url).toBe("/closecheck-docs/");
  });

  /**
   * A stand-in for Cloudflare R2, which is the provider actually chosen.
   *
   * R2's S3 API does not implement `x-amz-server-side-encryption` on PutObject — its compatibility
   * page lists it as unsupported, SSE-C only. This test encodes that constraint as something that
   * runs, rather than as a sentence in a docstring that a future change to the default would not
   * disturb. Against the previous default of "always send AES256", the first assertion here fails:
   * the very first upload to R2 would have been rejected.
   *
   * It does not claim to be R2. It is one property of R2, held still so a regression has to trip
   * over it.
   */
  describe("against a backend that refuses the encryption header, as R2 does", () => {
    beforeEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      requests = [];
      server = createServer((req, res) => {
        requests.push({ method: req.method!, url: req.url!, headers: req.headers });
        req.resume();
        if (req.headers["x-amz-server-side-encryption"] !== undefined) {
          res.writeHead(501, { "Content-Type": "application/xml" });
          res.end(
            '<?xml version="1.0"?><Error><Code>NotImplemented</Code>' +
              "<Message>Header not implemented</Message></Error>",
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/xml" });
        res.end('<?xml version="1.0"?><Result/>');
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      process.env.STORAGE_S3_ENDPOINT = `http://127.0.0.1:${port}`;
    });

    it("uploads successfully with the default configuration", async () => {
      await expect(
        (await store()).put("org1/evidence/f1/Toast_MSA.pdf", Buffer.from("%PDF-1.4"), "application/pdf"),
      ).resolves.toBeUndefined();
      expect(requests[0].headers["x-amz-server-side-encryption"]).toBeUndefined();
    });

    it("fails if the header is switched on, which is why it is not the default", async () => {
      process.env.STORAGE_S3_SSE = "AES256";
      await expect(
        (await store()).put("org1/evidence/f1/x.pdf", Buffer.from("x")),
      ).rejects.toThrow();
    });
  });

  it("heads the object before deleting, so absence is distinguishable", async () => {
    await (await store()).deleteIfPresent("org1/evidence/f1/x.pdf");
    expect(requests.map((r) => r.method)).toEqual(["HEAD", "DELETE"]);
    expect(requests[0].url).toContain("/closecheck-docs/org1/evidence/f1/x.pdf");
  });

  it("sends nothing at all for a key that fails containment", async () => {
    await expect((await store()).put("../escape.pdf", Buffer.from("x"))).rejects.toThrow(
      /not a plain relative object name/,
    );
    expect(requests, "a refused key must never reach the network").toHaveLength(0);
  });
});
