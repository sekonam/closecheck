/**
 * What a consultant is allowed to upload as evidence, and how it is classified.
 *
 * docs/spec.md §8 calls uploaded Tier B documents "the most sensitive data at rest" — yet the
 * evidence upload path accepted any file of any type at any size, while the far lower-risk firm
 * logo already had both an allowlist and an implicit cap. This closes that gap.
 *
 * The allowlist is deliberately broad, because the input is not ours to control: a seller hands
 * over whatever their POS vendor, processor or lawyer produced, and a consultant who cannot attach
 * the document they were actually given will attach nothing, which is a worse outcome than a
 * permissive list. So it covers the formats that genuinely turn up in a small-business deal, and
 * excludes only what is either dangerous or useless to a reviewer.
 */

/**
 * Formats that actually arrive in diligence: scanned and generated PDFs, photographed or
 * screenshotted documents, processor exports, and the Office/OpenDocument files brokers send.
 */
const ALLOWED_EVIDENCE_MIME_TYPES = new Map<string, string>([
  ["application/pdf", "PDF"],
  ["image/png", "PNG image"],
  ["image/jpeg", "JPEG image"],
  ["image/webp", "WebP image"],
  ["image/gif", "GIF image"],
  ["image/heic", "HEIC image"],
  ["image/heif", "HEIF image"],
  ["text/plain", "text file"],
  ["text/csv", "CSV"],
  ["application/csv", "CSV"],
  ["application/msword", "Word document"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word document"],
  ["application/vnd.ms-excel", "Excel workbook"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel workbook"],
  ["application/vnd.oasis.opendocument.text", "OpenDocument text"],
  ["application/vnd.oasis.opendocument.spreadsheet", "OpenDocument spreadsheet"],
  ["application/rtf", "RTF document"],
  ["text/rtf", "RTF document"],
]);

/**
 * Explicitly refused, with the reason, because "unsupported file type" is an unhelpful thing to
 * tell someone holding a document they were told to review.
 *
 * SVG is refused for the same reason the firm logo refuses it: an SVG is a script-execution vector,
 * and unlike a logo an evidence file can be opened by anyone the consultant shares access with.
 * Archives are refused because their contents cannot be checked — allowing one means allowing
 * whatever is inside it, unexamined.
 */
const REFUSED_WITH_REASON = new Map<string, string>([
  ["image/svg+xml", "SVG files can carry executable script, so they aren't accepted as evidence. Export it as a PNG or PDF instead."],
  ["text/html", "HTML files can carry executable script. Print the page to PDF and attach that instead."],
  ["application/zip", "Archives aren't accepted, because their contents can't be reviewed. Attach the individual documents instead."],
  ["application/x-zip-compressed", "Archives aren't accepted, because their contents can't be reviewed. Attach the individual documents instead."],
  ["application/x-rar-compressed", "Archives aren't accepted, because their contents can't be reviewed. Attach the individual documents instead."],
  ["application/x-7z-compressed", "Archives aren't accepted, because their contents can't be reviewed. Attach the individual documents instead."],
]);

/**
 * Per-file ceiling for one piece of evidence.
 *
 * This is NOT the defence against a huge upload — `bodySizeLimit: "20mb"` in next.config.ts is.
 * Next parses and materialises the whole multipart body before a server action is invoked, so by
 * the time this runs the bytes have already been received; there is no streaming hook to reject
 * earlier. The framework limit is what stops a 2 GB upload from reaching this code at all.
 *
 * What this cap is for is the error message. Tripping the framework limit produces an opaque
 * failure; tripping this one can name the file and the size. It therefore sits meaningfully BELOW
 * the body limit — the 5 MB gap leaves room for multipart overhead and the form's other fields, so
 * a file just under this cap can't trip the framework limit instead and produce the ugly error
 * anyway. A multi-page scanned contract lands well inside it.
 */
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

export type UploadVerdict =
  | { ok: true; mimeType: string; isImage: boolean }
  | { ok: false; message: string };

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function checkEvidenceUpload(file: { type: string; size: number; name: string }): UploadVerdict {
  if (file.size > MAX_EVIDENCE_BYTES) {
    return {
      ok: false,
      message: `That file is ${formatMegabytes(file.size)}. The limit for one attachment is ${formatMegabytes(
        MAX_EVIDENCE_BYTES,
      )} — split it or attach the relevant pages.`,
    };
  }

  // Normalise: browsers send "text/csv; charset=utf-8" for some files, and an empty type when the
  // OS has no association for the extension.
  const mimeType = file.type.split(";")[0].trim().toLowerCase();

  const refusal = REFUSED_WITH_REASON.get(mimeType);
  if (refusal) return { ok: false, message: refusal };

  if (!ALLOWED_EVIDENCE_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      message: mimeType
        ? `${mimeType} files aren't accepted as evidence. PDFs, images, text and CSV, and Word/Excel documents are.`
        : "That file's type couldn't be determined. Attach a PDF, image, text or CSV, or Word/Excel document.",
    };
  }

  return { ok: true, mimeType, isImage: mimeType.startsWith("image/") };
}

/**
 * Leading bytes each format must actually begin with.
 *
 * `file.type` is whatever the browser was told, and a scripted client sets it to anything it likes
 * — so the declared type alone is an assertion by the uploader, not a fact. Checking the content
 * against it means a file has to be what it claims. Formats with no magic number (plain text, CSV)
 * are absent here and are accepted on their declared type alone; there is nothing to check, and
 * the download path serves everything as an attachment with nosniff regardless.
 */
const MAGIC_BYTES: Array<{ mimeTypes: string[]; prefixes: number[][]; offset?: number }> = [
  { mimeTypes: ["application/pdf"], prefixes: [[0x25, 0x50, 0x44, 0x46]] }, // %PDF
  { mimeTypes: ["image/jpeg"], prefixes: [[0xff, 0xd8, 0xff]] },
  { mimeTypes: ["image/png"], prefixes: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  {
    mimeTypes: ["image/gif"],
    prefixes: [
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
    ],
  },
  { mimeTypes: ["image/webp"], prefixes: [[0x52, 0x49, 0x46, 0x46]] }, // RIFF container
  // HEIC/HEIF are ISO base-media files: the brand lives at offset 4, after the box size.
  { mimeTypes: ["image/heic", "image/heif"], prefixes: [[0x66, 0x74, 0x79, 0x70]], offset: 4 },
  {
    // Every OOXML and OpenDocument file is a zip underneath.
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.spreadsheet",
    ],
    prefixes: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  },
  {
    // Legacy .doc/.xls are OLE compound documents.
    mimeTypes: ["application/msword", "application/vnd.ms-excel"],
    prefixes: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  },
  { mimeTypes: ["application/rtf", "text/rtf"], prefixes: [[0x7b, 0x5c, 0x72, 0x74, 0x66]] }, // {\rtf
];

/**
 * Does the file's content match the type it claims to be?
 *
 * Called after the bytes are in hand, as a second gate behind `checkEvidenceUpload`. A mismatch is
 * refused rather than re-classified: silently trusting the content over the declaration would let
 * an uploader place a file of one type under another's label, which is the same confusion the
 * declaration-only check was vulnerable to, pointed the other way.
 */
export function checkEvidenceContent(mimeType: string, bytes: Uint8Array): UploadVerdict {
  const rule = MAGIC_BYTES.find((entry) => entry.mimeTypes.includes(mimeType));
  if (!rule) return { ok: true, mimeType, isImage: mimeType.startsWith("image/") };

  const offset = rule.offset ?? 0;
  const matches = rule.prefixes.some(
    (prefix) =>
      bytes.length >= offset + prefix.length &&
      prefix.every((byte, index) => bytes[offset + index] === byte),
  );

  if (!matches) {
    return {
      ok: false,
      message: `That file's contents don't match its ${mimeType} type. It may be corrupted, or renamed from another format — re-export it and try again.`,
    };
  }

  return { ok: true, mimeType, isImage: mimeType.startsWith("image/") };
}

/** Human-readable name for a stored MIME type, for display next to an attachment. */
export function describeMimeType(mimeType: string | null): string {
  if (!mimeType) return "document";
  return ALLOWED_EVIDENCE_MIME_TYPES.get(mimeType) ?? "document";
}
