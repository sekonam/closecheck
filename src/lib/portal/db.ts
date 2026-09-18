import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

/**
 * A separate client, deliberately not the shared `prisma` from src/lib/db/client.ts, connected as
 * `closecheck_portal` (PORTAL_DATABASE_URL) — a role granted SELECT on
 * `client_portal_links`/`reports` and INSERT on `portal_access_log`, nothing else, with every grant
 * additionally scoped by RLS to the one token presented in the current request (see
 * prisma/migrations/20260918100100_portal_role). Use this ONLY inside withPortalScope below, from the
 * public /portal/[token] route (spec.md §7) — never from any authenticated consultant-facing code
 * path, which should keep using withOrgScope instead.
 */
const globalForPortalPrisma = globalThis as unknown as { portalPrisma?: PrismaClient };

const portalPrisma =
  globalForPortalPrisma.portalPrisma ??
  new PrismaClient({ datasourceUrl: process.env.PORTAL_DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForPortalPrisma.portalPrisma = portalPrisma;
}

export type PortalTx = Prisma.TransactionClient;

/**
 * The application-layer half of the portal's isolation, mirroring withOrgScope (src/lib/db/scoped.ts)
 * exactly but scoped by token instead of org: sets `app.portal_token` for this transaction only, which
 * the RLS policies in 20260918100100_portal_role.sql require an exact match against before returning
 * (or accepting) a single row anywhere. A visitor who doesn't know a live, unexpired, unrevoked
 * token's exact value sees nothing at all, regardless of what the application code does or doesn't
 * check on top of that.
 */
export async function withPortalScope<T>(token: string, fn: (tx: PortalTx) => Promise<T>): Promise<T> {
  if (!token) {
    throw new Error("withPortalScope called without a token — refusing to run an unscoped query");
  }

  return portalPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.portal_token', ${token}, true)`;
    return fn(tx);
  });
}
