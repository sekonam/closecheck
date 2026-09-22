import { describe, expect, it } from "vitest";

import { attributionFor, describeEvidence, formatFileSize } from "./describeEvidence";

const BASE = {
  text: "scan_0043.pdf",
  label: null,
  mimeType: "application/pdf",
  sizeBytes: 2_411_724,
  createdAt: new Date("2026-09-14T09:30:00Z"),
  uploadedBy: { name: "J. Smith", email: "j@firm.example" },
};

describe("formatFileSize", () => {
  it("scales the unit to the size", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(2_411_724)).toBe("2.3 MB");
  });

  it("handles zero", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });
});

describe("attributionFor", () => {
  it("prefers the person's name", () => {
    expect(attributionFor({ name: "J. Smith", email: "j@firm.example" })).toBe("J. Smith");
  });

  it("falls back to the email when no name is set", () => {
    // Self-serve signup doesn't ask for a name, so this is the common case, not the edge one.
    expect(attributionFor({ name: null, email: "j@firm.example" })).toBe("j@firm.example");
    expect(attributionFor({ name: "   ", email: "j@firm.example" })).toBe("j@firm.example");
  });

  it("returns null when nobody is recorded", () => {
    // Rows written before provenance was captured have no answer, and inventing one would be worse.
    expect(attributionFor(null)).toBeNull();
    expect(attributionFor(undefined)).toBeNull();
  });
});

describe("describeEvidence", () => {
  it("names the type, size, person and date", () => {
    expect(describeEvidence(BASE)).toBe("PDF · 2.3 MB · added by J. Smith on 2026-09-14");
  });

  it("shows the real filename when a label stands in front of it", () => {
    // The consultant needs to know which file they're looking at — a seller's scanner-generated
    // name is often the only way to match it against what was actually sent over.
    expect(describeEvidence({ ...BASE, label: "Toast MSA, executed" })).toBe(
      "scan_0043.pdf · PDF · 2.3 MB · added by J. Smith on 2026-09-14",
    );
  });

  it("degrades to what it knows rather than printing unknowns", () => {
    expect(
      describeEvidence({
        text: "old.pdf",
        label: null,
        mimeType: null,
        sizeBytes: null,
        createdAt: new Date("2026-05-01T00:00:00Z"),
        uploadedBy: null,
      }),
    ).toBe("added 2026-05-01");
  });

  it("names an unrecognised type generically rather than echoing it", () => {
    expect(describeEvidence({ ...BASE, mimeType: "application/x-unknown" })).toMatch(/^document ·/);
  });
});
