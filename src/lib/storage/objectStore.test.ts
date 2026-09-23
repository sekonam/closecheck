import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Backend selection, and the production warning's wording.
 *
 * The warning is tested because its wording is the whole point of it. An operator who mounted the
 * persistent volume correctly and then reads a warning implying they did not will either start
 * ignoring it or "fix" something that was already right — so it has to name what is actually
 * missing (encryption at rest, redundancy) rather than warn generically about persistence.
 */
const SAVED = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("STORAGE_")) delete process.env[key];
  }
  // vi.stubEnv rather than assignment: NODE_ENV is typed read-only, and unstubbing restores it
  // without the test having to remember the original value.
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function fresh() {
  const mod = await import("./objectStore");
  mod.resetStorageBackend();
  return mod;
}

describe("backend selection", () => {
  it("defaults to local so development needs no configuration", async () => {
    const mod = await fresh();
    expect(mod.storageBackend().kind).toBe("local");
    expect(mod.describeStorage()).toMatch(/local filesystem at /);
  });

  it("uses S3 as soon as a bucket is named", async () => {
    process.env.STORAGE_S3_BUCKET = "closecheck-prod";
    const mod = await fresh();
    expect(mod.storageBackend().kind).toBe("s3");
    expect(mod.describeStorage()).toContain("closecheck-prod");
  });

  it("names the endpoint too, so a non-AWS provider is visible in logs", async () => {
    process.env.STORAGE_S3_BUCKET = "closecheck-prod";
    process.env.STORAGE_S3_ENDPOINT = "https://account.r2.cloudflarestorage.com";
    const mod = await fresh();
    expect(mod.describeStorage()).toContain("r2.cloudflarestorage.com");
  });

  it("keeps the key helpers backend-independent", async () => {
    // The same key names the same document whichever backend holds it, which is what makes moving
    // between them a copy rather than a rewrite.
    const local = await import("./local");
    process.env.STORAGE_S3_BUCKET = "closecheck-prod";
    const mod = await fresh();
    expect(mod.reportPdfKey("org1", "r1")).toBe(local.reportPdfKey("org1", "r1"));
    expect(mod.evidenceKey("org1", "f1", "e1", "a.pdf")).toBe(local.evidenceKey("org1", "f1", "e1", "a.pdf"));
  });
});

describe("local disk in production is refused unless acknowledged", () => {
  /**
   * This was a boot-time warning while render.yaml mounted a persistent disk. The blueprint no
   * longer does — documents go to R2 — so an unconfigured production process would be writing
   * seller contracts to the container's ephemeral filesystem, and a warning in a boot log is the
   * silent path to losing all of them on the next deploy. The refusal is enforced where every
   * storage operation resolves its backend, not only at boot.
   */
  it("is not enforced outside production", async () => {
    const mod = await fresh();
    expect(mod.storageBackend().kind).toBe("local");
  });

  it("does not apply when object storage is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.STORAGE_S3_BUCKET = "closecheck-prod";
    const mod = await fresh();
    expect(mod.storageBackend().kind).toBe("s3");
  });

  it("refuses every operation in production on unacknowledged local disk, saying why", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mod = await fresh();
    expect(() => mod.storageBackend()).toThrow(/Refusing to use local disk in production/);
    // The message has to carry the remedy, because the operator reading it is mid-deploy.
    expect(() => mod.storageBackend()).toThrow(/STORAGE_S3_BUCKET/);
    expect(() => mod.storageBackend()).toThrow(/STORAGE_ACKNOWLEDGE_LOCAL=true/);
    // And it reaches the operations, not only the resolver.
    await expect(mod.putObject("org1", "org1/x.txt", Buffer.from("x"))).rejects.toThrow(/Refusing/);
    await expect(mod.getObject("org1", "org1/x.txt")).rejects.toThrow(/Refusing/);
    await expect(mod.assertStorageUsable()).rejects.toThrow(/Refusing/);
  });

  it("is lifted by an explicit acknowledgement, which then names the cost once at boot", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.STORAGE_ACKNOWLEDGE_LOCAL = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await fresh();
    expect(mod.storageBackend().kind).toBe("local");
    mod.reportStorageBackendAtBoot();
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    expect(text).toMatch(/[Ee]ncryption at rest/);
    expect(text).toMatch(/redundancy/);
  });

  it("reports the refusal at boot at error level without throwing out of the boot hook", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await fresh();
    expect(() => mod.reportStorageBackendAtBoot()).not.toThrow();
    expect(String(error.mock.calls[0]?.[0])).toMatch(/Refusing to use local disk/);
  });
});

describe("assertUsable on the local backend", () => {
  it("refuses a storage root that does not exist", async () => {
    process.env.STORAGE_ROOT_DIR = "/tmp/closecheck-definitely-not-here-xyz";
    const mod = await fresh();
    await expect(mod.assertStorageUsable()).rejects.toThrow(/does not exist or is not a directory/);
  });

  it("passes for a real directory", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "closecheck-store-"));
    try {
      process.env.STORAGE_ROOT_DIR = dir;
      const mod = await fresh();
      await expect(mod.assertStorageUsable()).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
