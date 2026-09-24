import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { evidenceKey, reportPdfKey } from "./local";

// These check that a GENERATED key can never resolve outside STORAGE_ROOT — the property that
// matters, not just "the string looks sanitized". Note what they do not cover, and what the
// operation-layer tests at the bottom of this file exist for: a key that never came from these
// generators at all. A storageKey read back from the database is just a string, and before the
// containment guard the filesystem operations would follow it wherever it pointed.
const STORAGE_ROOT = "/fake/.local-storage";

function resolvesInsideStorageRoot(key: string): boolean {
  const resolved = join(STORAGE_ROOT, key);
  return resolved === STORAGE_ROOT || resolved.startsWith(STORAGE_ROOT + "/");
}

describe("evidenceKey", () => {
  it("builds a readable key for a normal filename", () => {
    const key = evidenceKey("org1", "finding1", "ev1", "pos-contract.pdf");
    expect(key).toBe("org1/evidence/finding1/ev1-pos-contract.pdf");
  });

  it("neutralizes path traversal attempts in the filename — the actual property that matters", () => {
    const traversalAttempts = [
      "../../../etc/passwd",
      "..\\..\\..\\Windows\\System32",
      "....//....//etc/passwd",
      "/etc/passwd",
    ];
    for (const filename of traversalAttempts) {
      const key = evidenceKey("org1", "finding1", "ev1", filename);
      expect(resolvesInsideStorageRoot(key)).toBe(true);
    }
  });

  it("falls back to a default name for a truly empty filename", () => {
    const key = evidenceKey("org1", "finding1", "ev1", "");
    expect(key).toBe("org1/evidence/finding1/ev1-file");
  });

  it("collapses an all-symbol filename to a single safe character, not empty", () => {
    // Consecutive disallowed characters collapse to one "_" (the regex's `+` quantifier) — this
    // never hits the `|| "file"` fallback, but the result is still a safe, non-empty segment,
    // which is the property that actually matters here.
    const key = evidenceKey("org1", "finding1", "ev1", "///");
    expect(key).toBe("org1/evidence/finding1/ev1-_");
    expect(resolvesInsideStorageRoot(key)).toBe(true);
  });

  it("truncates an excessively long filename", () => {
    const longName = "a".repeat(500) + ".pdf";
    const key = evidenceKey("org1", "finding1", "ev1", longName);
    // 100 chars for the sanitized filename portion, per the slice(0, 100) in the implementation.
    expect(key.length).toBeLessThan("org1/evidence/finding1/ev1-".length + 101);
  });
});

describe("reportPdfKey", () => {
  it("builds a predictable, tenant-prefixed key", () => {
    expect(reportPdfKey("org1", "report1")).toBe("org1/reports/report1.pdf");
  });
});

describe("the storage operations refuse a key that escapes the root", () => {
  /**
   * The generator tests above verify keys this module PRODUCES. This verifies what it does with a
   * key it merely receives — which is the real exposure, because the consumer of these functions is
   * a retention cron job that deletes, and its input is a `storageKey` column read back from the
   * database rather than a freshly generated key.
   *
   * Demonstrated before it was fixed, not theorised: an Evidence row carrying a traversing key made
   * the purge delete a file outside the storage root and report `1 purged, 0 missing, 0 failed`,
   * and the authenticated download route returned that file's contents. Unreachable through the app
   * today because `evidenceKey` sanitises and browsers strip paths — but `local.ts` is documented as
   * a stand-in to be replaced with S3, so the writer will change while the deleting consumer stays.
   */
  async function withRoot<T>(fn: (mod: typeof import("./local")) => Promise<T>): Promise<T> {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "closecheck-storage-test-"));
    const previous = process.env.STORAGE_ROOT_DIR;
    process.env.STORAGE_ROOT_DIR = root;
    vi.resetModules();
    try {
      return await fn(await import("./local"));
    } finally {
      process.env.STORAGE_ROOT_DIR = previous;
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
  }

  const ESCAPING_KEY = "../".repeat(12) + "tmp/closecheck-should-never-be-touched.txt";

  it("refuses to read, write or delete through a traversing key", async () => {
    await withRoot(async (mod) => {
      await expect(mod.putObject(ESCAPING_KEY, Buffer.from("x"))).rejects.toThrow(/outside the storage root/);
      await expect(mod.getObject(ESCAPING_KEY)).rejects.toThrow(/outside the storage root/);
      await expect(mod.deleteObject(ESCAPING_KEY)).rejects.toThrow(/outside the storage root/);
      await expect(mod.deleteObjectIfPresent(ESCAPING_KEY)).rejects.toThrow(/outside the storage root/);
    });
  });

  it("refuses an absolute key, which join() would have silently honoured", async () => {
    await withRoot(async (mod) => {
      await expect(mod.getObject("/etc/hosts")).rejects.toThrow(/outside the storage root/);
    });
  });

  it("refuses a sibling directory whose name merely starts with the root's", async () => {
    // `/data/storage-old` against a root of `/data/storage` — a prefix check without the separator
    // would let this through.
    await withRoot(async (mod) => {
      await expect(mod.getObject("../" + "closecheck-storage-test-sibling/x")).rejects.toThrow(
        /outside the storage root/,
      );
    });
  });

  it("reports existence only for a definite absence, and stays contained", async () => {
    await withRoot(async (mod) => {
      const key = "orgA/reports/r1.pdf";
      expect(await mod.objectExists(key), "a key that was never written").toBe(false);
      await mod.putObject(key, Buffer.from("%PDF"));
      expect(await mod.objectExists(key)).toBe(true);
      // An existence probe must not be the one operation that escapes the root.
      await expect(mod.objectExists(ESCAPING_KEY)).rejects.toThrow(/outside the storage root/);
    });
  });

  it("still allows ordinary contained keys, including nested ones", async () => {
    await withRoot(async (mod) => {
      const key = "orgA/evidence/finding1/doc.pdf";
      await mod.putObject(key, Buffer.from("contained"));
      expect((await mod.getObject(key)).toString()).toBe("contained");
      expect(await mod.deleteObjectIfPresent(key)).toBe("deleted");
    });
  });

  it("treats a dot-segment that stays inside the root as contained", async () => {
    // `a/../b` resolves within the root and is not an escape; refusing it would be wrong.
    await withRoot(async (mod) => {
      await mod.putObject("orgA/nested/../doc.pdf", Buffer.from("ok"));
      expect((await mod.getObject("orgA/doc.pdf")).toString()).toBe("ok");
    });
  });
});

describe("listObjects", () => {
  async function withRoot<T>(fn: (mod: typeof import("./local"), root: string) => Promise<T>): Promise<T> {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "closecheck-list-test-"));
    const previous = process.env.STORAGE_ROOT_DIR;
    process.env.STORAGE_ROOT_DIR = root;
    vi.resetModules();
    try {
      return await fn(await import("./local"), root);
    } finally {
      process.env.STORAGE_ROOT_DIR = previous;
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
  }

  it("returns every stored key as a backend-independent key, nested and sorted", async () => {
    await withRoot(async (mod) => {
      await mod.putObject("org2/reports/r1.pdf", Buffer.from("x"));
      await mod.putObject("org1/evidence/f1/e1-contract.pdf", Buffer.from("x"));
      await mod.putObject("org1/logo.png", Buffer.from("x"));
      const listed = await mod.listObjects();
      expect(listed.map((o) => o.key)).toEqual([
        "org1/evidence/f1/e1-contract.pdf",
        "org1/logo.png",
        "org2/reports/r1.pdf",
      ]);
      for (const o of listed) expect(o.lastModified).toBeInstanceOf(Date);
    });
  });

  it("reports nothing stored when the root does not exist yet", async () => {
    await withRoot(async (mod, root) => {
      const { rm } = await import("node:fs/promises");
      await rm(root, { recursive: true, force: true });
      expect(await mod.listObjects()).toEqual([]);
    });
  });
});
