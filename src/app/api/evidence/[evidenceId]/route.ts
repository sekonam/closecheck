import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/objectStore";
import { UNTRUSTED_CONTENT_CSP, fileResponseHeaders } from "@/lib/http/fileResponseHeaders";

export async function GET(_request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const { evidenceId } = await params;
  const { orgId } = await requireOrgSession();

  const evidence = await withOrgScope(orgId, (tx) => tx.evidence.findUnique({ where: { id: evidenceId } }));

  // RLS already prevents this from resolving another org's evidence; null here just means "not
  // found," not a tenant leak.
  if (!evidence || !evidence.storageKey) {
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await getObject(evidence.storageKey);
  } catch {
    // Row exists but the file behind it doesn't (e.g. a partial purge/upload failure) — a clean
    // 404 beats letting the ENOENT throw out of the route handler as an unhandled 500.
    return NextResponse.json({ error: "Evidence file not found" }, { status: 404 });
  }

  // The original filename can contain characters (CR/LF, non-Latin-1, quotes) that are legal in
  // `evidence.text` but not in a raw Content-Disposition header value — stripping quotes alone
  // isn't enough. `filename` is a plain-ASCII fallback for older clients; `filename*` (RFC 5987)
  // carries the real name for everything else.
  // Trimmed, and with the same fallback the ASCII form uses: a file uploaded as ".." stores an
  // empty name, which produced `filename*=UTF-8''` — a parameter with no value, which is malformed
  // rather than merely unhelpful.
  const rawFilename = evidence.text?.trim() || "evidence";
  // Backslash is stripped along with the quote: it is the escape character inside a quoted-string,
  // so a file named `a\` produces `filename="a\"; filename*=...` and a compliant parser swallows
  // the filename* parameter as part of the quoted value — losing the real name entirely.
  const asciiFilename =
    rawFilename.replace(/[\r\n"\\]/g, "").replace(/[^\x20-\x7e]/g, "_") || "evidence";
  const encodedFilename = encodeURIComponent(rawFilename.replace(/[\r\n]/g, ""));

  return new NextResponse(new Uint8Array(bytes), {
    headers: fileResponseHeaders({
      // Deliberately NOT the file's own MIME type. A seller's document is content this product
      // neither authored nor can vouch for, and serving it inline from the app's own origin would
      // make any HTML or SVG among it a stored-XSS vector against the consultant's session.
      // octet-stream plus an attachment disposition means the browser saves it rather than
      // rendering it, whatever it turns out to be.
      contentType: "application/octet-stream",
      disposition: "attachment",
      filename: asciiFilename,
      filenameEncoded: encodedFilename,
      // Covers the case where some future change makes a response here inline: with no sources
      // permitted, a document that did get rendered still cannot load or execute anything.
      csp: UNTRUSTED_CONTENT_CSP,
    }),
  });
}
