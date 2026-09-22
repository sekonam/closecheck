import { describe, expect, it } from "vitest";

import {
  MAX_EVIDENCE_BYTES,
  checkEvidenceContent,
  checkEvidenceUpload,
  describeMimeType,
} from "./uploadPolicy";

function upload(type: string, size = 1024, name = "file") {
  return checkEvidenceUpload({ type, size, name });
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);

describe("declared-type check", () => {
  it("accepts the formats diligence documents actually arrive as", () => {
    for (const type of [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/heic",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
    ]) {
      expect(upload(type).ok, type).toBe(true);
    }
  });

  it("strips charset parameters before matching", () => {
    // Browsers send "text/csv; charset=utf-8" for some files.
    const verdict = upload("text/csv; charset=utf-8");
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.mimeType).toBe("text/csv");
  });

  it("refuses script-carrying formats with a reason that says what to do instead", () => {
    // Same reasoning as the firm-logo upload, which already refuses SVG for stored-XSS reasons.
    const svg = upload("image/svg+xml");
    expect(svg.ok).toBe(false);
    if (!svg.ok) expect(svg.message).toMatch(/PNG or PDF/);

    const html = upload("text/html");
    expect(html.ok).toBe(false);
    if (!html.ok) expect(html.message).toMatch(/Print the page to PDF/);
  });

  it("refuses archives, whose contents cannot be reviewed", () => {
    expect(upload("application/zip").ok).toBe(false);
    expect(upload("application/x-7z-compressed").ok).toBe(false);
  });

  it("refuses an unknown or absent type", () => {
    expect(upload("application/x-msdownload").ok).toBe(false);
    const unknown = upload("");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toMatch(/couldn't be determined/);
  });

  it("refuses an oversized file and names the sizes", () => {
    const verdict = upload("application/pdf", MAX_EVIDENCE_BYTES + 1);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/15\.0 MB/);
  });

  it("stays below the Server Actions body limit", () => {
    // next.config.ts sets bodySizeLimit to 20mb. This cap exists for the error message, so it must
    // sit far enough under that a file passing it can't trip the framework limit instead.
    expect(MAX_EVIDENCE_BYTES).toBeLessThan(18 * 1024 * 1024);
  });

  it("classifies images so they can be recorded as screenshots", () => {
    const image = upload("image/png");
    expect(image.ok && image.isImage).toBe(true);
    const pdf = upload("application/pdf");
    expect(pdf.ok && pdf.isImage).toBe(false);
  });
});

describe("content check", () => {
  it("accepts content matching its declared type", () => {
    expect(checkEvidenceContent("application/pdf", PDF).ok).toBe(true);
    expect(checkEvidenceContent("image/png", PNG).ok).toBe(true);
    expect(
      checkEvidenceContent(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ZIP,
      ).ok,
    ).toBe(true);
  });

  it("refuses content that does not match its declared type", () => {
    // file.type is an assertion by the uploader, not a fact — a scripted client sets it freely.
    const verdict = checkEvidenceContent("application/pdf", PNG);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/don't match/);

    expect(checkEvidenceContent("image/png", ZIP).ok).toBe(false);
  });

  it("refuses a file too short to carry its own signature", () => {
    expect(checkEvidenceContent("application/pdf", new Uint8Array([0x25])).ok).toBe(false);
    expect(checkEvidenceContent("image/png", new Uint8Array()).ok).toBe(false);
  });

  it("checks HEIC's box type at its real offset, not the start", () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(checkEvidenceContent("image/heic", heic).ok).toBe(true);
    expect(checkEvidenceContent("image/heic", PNG).ok).toBe(false);
  });

  it("refuses a container that matches the prefix but is another media type", () => {
    // RIFF is shared with WAV and AVI; "ftyp" is shared with MP4 and QuickTime. Checking only the
    // container prefix accepts an audio file as a WebP and a video as a HEIC.
    const riffWave = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(checkEvidenceContent("image/webp", riffWave).ok).toBe(false);
    const riffWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(checkEvidenceContent("image/webp", riffWebp).ok).toBe(true);

    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(checkEvidenceContent("image/heic", mp4).ok).toBe(false);
  });

  it("accepts every still-image brand HEIC actually uses", () => {
    for (const brand of ["heic", "heix", "hevc", "mif1", "msf1"]) {
      const bytes = new Uint8Array([
        0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70,
        ...[...brand].map((c) => c.charCodeAt(0)),
      ]);
      expect(checkEvidenceContent("image/heic", bytes).ok, brand).toBe(true);
    }
  });

  it("accepts formats that have no signature to check", () => {
    // Plain text and CSV have no magic number. There is nothing to verify, and the download path
    // serves everything as an attachment with nosniff regardless.
    expect(checkEvidenceContent("text/csv", new Uint8Array([0x61, 0x2c, 0x62])).ok).toBe(true);
    expect(checkEvidenceContent("text/plain", new Uint8Array()).ok).toBe(true);
  });
});

describe("describeMimeType", () => {
  it("names known types and falls back for anything else", () => {
    expect(describeMimeType("application/pdf")).toBe("PDF");
    expect(describeMimeType("image/png")).toBe("PNG image");
    expect(describeMimeType(null)).toBe("document");
    expect(describeMimeType("application/unknown")).toBe("document");
  });
});
