import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authPrisma } from "@/lib/auth/db";

// Auth reads the `users` table via authPrisma (src/lib/auth/db.ts), not the shared `prisma` client
// and not withOrgScope: at sign-in time there is no authenticated org session yet — that's exactly
// what this step establishes — so there is nothing to scope by. authPrisma connects as a role
// granted SELECT on `users` only, nothing else — every route AFTER sign-in must use withOrgScope on
// the shared client; this file is the one deliberate exception, and it only ever reads by unique
// email, never lists across orgs.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await authPrisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, orgId: user.orgId };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.orgId = (user as { orgId: string }).orgId;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.orgId = token.orgId as string;
        // token.sub is Auth.js's own standard claim, set automatically to the id authorize()
        // returned and preserved across every subsequent jwt() call — this was never copied onto
        // the session, so requireOrgSession()'s userId (src/lib/auth/session.ts) has been silently
        // undefined this entire time. Nothing needed it until src/lib/actions/team.ts's
        // owner-only checks became the first real consumer — found live, testing the invite form
        // never rendering for an actual account owner.
        session.user.id = token.sub as string;
      }
      return session;
    },
  },
});
