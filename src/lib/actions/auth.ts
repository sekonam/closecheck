"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth/config";
import { signupPrisma } from "@/lib/auth/signupDb";

const signUpSchema = z
  .object({
    orgName: z.string().trim().min(1, "Firm name is required"),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

/**
 * Self-serve signup (docs/roadmap.md Phase 2). Creates a brand-new ConsultantOrg + its first
 * (OWNER) User with no existing org session to scope by — the same bootstrap shape prisma/seed.ts
 * solves with the superuser role, but this is a public, unauthenticated runtime path, so it uses the
 * narrowly-scoped closecheck_signup role instead (src/lib/auth/signupDb.ts).
 *
 * Deliberately raw $executeRaw INSERTs, not signupPrisma.consultantOrg.create()/user.create():
 * Postgres requires SELECT privilege to honor INSERT ... RETURNING, which Prisma's create() always
 * uses, and closecheck_signup has no SELECT grant at all (prisma/migrations/20260918100000_signup_role)
 * — deliberately, so a bug or leaked credential on this connection can never browse existing orgs'
 * users, only ever insert one new pair. See scripts/verify-signup-portal-roles.ts for the same
 * pattern already verified working.
 *
 * A brand-new org gets no disclaimerAcknowledgedAt, no brand color, no logo — schema defaults only,
 * same disclaimer-review gate (src/lib/actions/reports.ts) as every other org, no special-cased
 * bypass for self-serve signups.
 */
export async function signUp(formData: FormData): Promise<void> {
  const result = signUpSchema.safeParse({
    orgName: formData.get("orgName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid signup input.");
  }
  const { orgName, email, password } = result.data;

  const orgId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await signupPrisma.$transaction([
      signupPrisma.$executeRaw`
        INSERT INTO "consultant_orgs" (id, name, "createdAt", "updatedAt")
        VALUES (${orgId}, ${orgName}, now(), now())
      `,
      signupPrisma.$executeRaw`
        INSERT INTO "users" (id, "orgId", email, "passwordHash", role, "createdAt")
        VALUES (${userId}, ${orgId}, ${email}, ${passwordHash}, 'OWNER', now())
      `,
    ]);
  } catch (err) {
    // closecheck_signup has no SELECT grant, so there's no clean way to check "does this email
    // already exist" before attempting the insert — the users.email UNIQUE constraint is the only
    // thing enforcing that, and its violation is what we're translating into a readable message here
    // rather than letting a raw Postgres constraint error surface.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("23505") || message.toLowerCase().includes("duplicate key")) {
      throw new Error("An account with that email already exists.");
    }
    throw err;
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/engagements" });
  } catch (err) {
    // signIn() throws NEXT_REDIRECT (via AuthError's redirect path) on success in some next-auth
    // versions' server-action flow — only a genuine AuthError (bad credentials) should be swallowed
    // into a redirect back to login; anything else (including the expected redirect signal) must
    // propagate so the actual navigation happens.
    if (err instanceof AuthError) {
      throw new Error("Account created, but automatic sign-in failed — sign in manually.");
    }
    throw err;
  }
}
