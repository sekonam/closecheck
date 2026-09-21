/**
 * Rotates the 5 narrow-privilege Postgres roles (closecheck_app, closecheck_auth, closecheck_signup,
 * closecheck_portal, closecheck_api) off the hardcoded dev passwords baked into their CREATE ROLE migrations
 * (prisma/migrations/20260911160500_*, 20260911161500_*, 20260918100000_*, 20260918100100_*,
 * 20260921120000_*) —
 * those migrations only set a password at first role creation (`IF NOT EXISTS`), so a fresh
 * production database ends up with roles literally named e.g. closecheck_app_dev unless this runs
 * immediately after the first `prisma migrate deploy`.
 *
 * Connects via DIRECT_DATABASE_URL (the superuser/migration role — only it can ALTER ROLE). Prints
 * the resulting connection strings once, to stdout only — nothing is written to a file or logged
 * anywhere else. Copy each one into its matching *_DATABASE_URL production env var immediately, then
 * clear your terminal scrollback.
 *
 * Run with: npx tsx -r dotenv/config scripts/rotate-production-role-passwords.ts
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ROLES = ["closecheck_app", "closecheck_auth", "closecheck_signup", "closecheck_portal", "closecheck_api"] as const;

function randomPassword(): string {
  // base64url avoids characters (/, +, =) that would need escaping inside a connection string.
  return randomBytes(24).toString("base64url");
}

async function main() {
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (!directUrl) throw new Error("DIRECT_DATABASE_URL is not set.");

  const prisma = new PrismaClient({ datasourceUrl: directUrl });

  try {
    for (const role of ROLES) {
      const password = randomPassword();
      // Role names come from the fixed ROLES list above, never user input — executeRawUnsafe is
      // safe here specifically because nothing in the interpolated identifier is attacker-influenced
      // (ALTER ROLE's role name can't be parameterized like a value can).
      await prisma.$executeRawUnsafe(`ALTER ROLE ${role} WITH PASSWORD '${password}'`);

      const roleUrl = new URL(directUrl);
      roleUrl.username = role;
      roleUrl.password = password;
      const envVar = role === "closecheck_app" ? "DATABASE_URL" : `${role.replace("closecheck_", "").toUpperCase()}_DATABASE_URL`;
      console.log(`${envVar}=${roleUrl.toString()}`);
    }
    console.log(`\nDIRECT_DATABASE_URL itself is untouched — rotate the superuser/owner password separately through your provider's dashboard if desired.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
