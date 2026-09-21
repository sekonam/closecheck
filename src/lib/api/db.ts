import { PrismaClient } from "@prisma/client";

/**
 * A separate client, deliberately not the shared `prisma` from src/lib/db/client.ts, connected as
 * `closecheck_api` (API_DATABASE_URL) — a role granted SELECT on `api_keys` plus UPDATE on that
 * table's single "lastUsedAt" column, and nothing else at all (see
 * prisma/migrations/20260921120000_api_keys_and_webhooks). It exists for the one cross-tenant lookup
 * the public API needs: finding a key row by token hash before any org is known — the same shape as
 * sign-in's email lookup (src/lib/auth/db.ts) and the portal's token lookup (src/lib/portal/db.ts).
 * Use it ONLY inside src/lib/api/auth.ts; every actual data read after authentication goes through
 * withOrgScope on the normal app client, so the API path gets the same RLS enforcement as the
 * interactive app (docs/spec.md §8, §13.2).
 */
const globalForApiPrisma = globalThis as unknown as { apiPrisma?: PrismaClient };

export const apiPrisma =
  globalForApiPrisma.apiPrisma ??
  new PrismaClient({ datasourceUrl: process.env.API_DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForApiPrisma.apiPrisma = apiPrisma;
}
