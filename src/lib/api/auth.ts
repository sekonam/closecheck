import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiPrisma } from "./db";

/**
 * Bearer-token authentication for the read-only API (docs/spec.md §13.2).
 *
 * Token format: `cc_live_` + 43 chars of base64url (32 random bytes). The plaintext exists only in
 * the createApiKey action's response cookie and the caller's own storage — the database holds
 * sha256(token) as the unique lookup column (see the ApiKey model comment for why sha256, not
 * bcrypt, is the right hash for a high-entropy random credential).
 */
const TOKEN_PREFIX = "cc_live_";
const TOKEN_PREFIX_DISPLAY_LENGTH = TOKEN_PREFIX.length + 6;

export function generateApiToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, tokenHash: hashApiToken(token), tokenPrefix: token.slice(0, TOKEN_PREFIX_DISPLAY_LENGTH) };
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ApiAuthResult = { orgId: string; apiKeyId: string };

/**
 * Resolves the request's bearer token to an org, or null for any failure — the route returns the
 * same 401 for "no header", "unknown token", and "revoked token" so the API doesn't confirm which
 * of those a probing caller hit.
 *
 * The lastUsedAt touch is fire-and-forget and throttled to once a minute per key: it exists so the
 * settings UI can show stale keys (spec.md §13.2), not as an audit log, and a write per API request
 * would be a self-inflicted load problem.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const key = await apiPrisma.apiKey.findUnique({ where: { tokenHash: hashApiToken(token) } });
  if (!key || key.revokedAt) return null;

  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    apiPrisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        // Losing a lastUsedAt tick must never fail the request itself.
      });
  }

  return { orgId: key.orgId, apiKeyId: key.id };
}

export function apiUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Missing, unknown, or revoked API key. Pass `Authorization: Bearer cc_live_...`." },
    { status: 401 },
  );
}

export function apiNotFound(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
