import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { evidenceKey, reportPdfKey } from "./local";

// putObject/getObject build paths via `join(STORAGE_ROOT, key)` — these tests check that the key
// itself can never resolve outside STORAGE_ROOT once joined, which is the actual property that
// matters (not just "the string looks sanitized").
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
