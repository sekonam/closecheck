import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { getObject } from "@/lib/storage/local";

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
  const rawFilename = evidence.text ?? "evidence";
  const asciiFilename = rawFilename.replace(/[\r\n"]/g, "").replace(/[^\x20-\x7e]/g, "_") || "evidence";
  const encodedFilename = encodeURIComponent(rawFilename.replace(/[\r\n]/g, ""));

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    },
  });
}
