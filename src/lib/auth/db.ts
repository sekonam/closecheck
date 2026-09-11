import { PrismaClient } from "@prisma/client";

/**
 * A separate client, deliberately not the shared `prisma` from src/lib/db/client.ts, connected as
 * `closecheck_auth` (AUTH_DATABASE_URL) — a role granted SELECT on `users` and nothing else at all,
 * with an RLS policy scoped to that role permitting the cross-org lookup sign-in needs (see
 * prisma/migrations/20260911161500_auth_lookup_role). Use this ONLY for the email lookup in
 * src/lib/auth/config.ts's authorize() callback — never for anything else, and never let this client
 * touch any table other than `users` even though nothing stops it in code today; the enforcement is
 * the database grant, but keeping the usage narrow in application code is what keeps that grant
 * meaningful instead of an accident waiting to be widened.
 */
const globalForAuthPrisma = globalThis as unknown as { authPrisma?: PrismaClient };

export const authPrisma =
  globalForAuthPrisma.authPrisma ??
  new PrismaClient({ datasourceUrl: process.env.AUTH_DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForAuthPrisma.authPrisma = authPrisma;
}
