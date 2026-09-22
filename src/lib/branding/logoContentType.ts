/**
 * The one answer to "what type is this logo", for every path that has to decide.
 *
 * WHY THIS IS DERIVED FROM THE KEY'S EXTENSION AND NOT FROM THE UPLOAD
 * -------------------------------------------------------------------
 * A logo's declared MIME type is an assertion by the uploader; `uploadOrgLogo` checks it against an
 * allowlist but does not verify the bytes behind it, unlike evidence uploads
 * (src/lib/storage/uploadPolicy.ts, which reads the file's own leading bytes). So the declared type
 * is the wrong thing to carry forward. What the serving paths actually act on is the stored key's
 * extension, and the safe property is that the type served and the type stored agree — a file whose
 * content does not match simply fails to render as an image, which is the outcome we want and the
 * reason nothing here needs to execute it.
 *
 * SVG IS ABSENT ON PURPOSE. An SVG is a document that can carry script, so an uploaded file
 * claiming to be one must never come back with a type that invites a browser to run it. An
 * unrecognised extension resolves to null, and each caller degrades safely: the authenticated route
 * serves `application/octet-stream`, and the portal renders the firm's name with no logo.
 *
 * WHY IT IS ONE MODULE. This map previously existed in three copies — the authenticated logo route,
 * the portal's data-URI builder, and the report renderer's — each with its own comment explaining
 * that it was the security boundary. Three copies of a security boundary is one copy and two
 * opportunities for it to drift, and the one that drifts is the one nobody re-read.
 */
const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The type to serve or store for a logo at this key, or null if the extension is not one we vouch for. */
export function logoContentTypeFor(storageKeyOrFilename: string | null): string | null {
  if (!storageKeyOrFilename) return null;
  const extension = storageKeyOrFilename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_CONTENT_TYPE[extension] ?? null;
}

/** The MIME types `uploadOrgLogo` accepts as a declared type. Kept beside the extension map so the
 * two cannot describe different sets of formats. */
export const ALLOWED_LOGO_MIME_TYPES: ReadonlySet<string> = new Set(
  Object.values(EXTENSION_CONTENT_TYPE),
);
