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
 * "not yet exercised against a real endpoint" caveat in s3.ts stands until someone points it at a
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

  it("omits the encryption header when it is turned off", async () => {
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
