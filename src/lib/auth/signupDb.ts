import { PrismaClient } from "@prisma/client";

/**
 * A separate client, deliberately not the shared `prisma` from src/lib/db/client.ts, connected as
 * `closecheck_signup` (SIGNUP_DATABASE_URL) — a role granted INSERT on `consultant_orgs`/`users` only,
 * nothing else, not even SELECT (see prisma/migrations/20260918100000_signup_role). Use this ONLY for
 * the bootstrap create in src/lib/actions/auth.ts's signUp() — the one legitimate unauthenticated
 * write in the app, creating the very first row of a brand-new org before any session exists to scope
 * a normal withOrgScope call by.
 */
const globalForSignupPrisma = globalThis as unknown as { signupPrisma?: PrismaClient };

export const signupPrisma =
  globalForSignupPrisma.signupPrisma ??
  new PrismaClient({ datasourceUrl: process.env.SIGNUP_DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForSignupPrisma.signupPrisma = signupPrisma;
}
