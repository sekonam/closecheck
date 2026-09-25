import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authPrisma } from "@/lib/auth/db";
import {
  addressAttemptAllowed,
  clearFailedSignIns,
  clientAddressFrom,
  focusedGuessingAllowed,
  recordFailedSignIn,
} from "@/lib/auth/rateLimit";

// Auth reads the `users` table via authPrisma (src/lib/auth/db.ts), not the shared `prisma` client
// and not withOrgScope: at sign-in time there is no authenticated org session yet — that's exactly
// what this step establishes — so there is nothing to scope by. authPrisma connects as a role
// granted SELECT on `users` only, nothing else — every route AFTER sign-in must use withOrgScope on
// the shared client; this file is the one deliberate exception, and it only ever reads by unique
// email, never lists across orgs.
/**
 * A real bcrypt hash at the same cost factor the app uses, of a value no password can be. Its only
 * job is to give the "no such user" path identical work to the "wrong password" path; it is not a
 * credential and nothing can authenticate against it.
 */
const DUMMY_PASSWORD_HASH = "$2b$10$p8065EY9xQWymfpjfyaMF.v.MeDMzJMhzkDXnStxcN2yrnB0Q7s52";

export const { handlers, auth, signIn, signOut } = NextAuth({
  /**
   * Required in production, and invisible in development, which is how it stayed unset until the
   * E2E plan ran the suite against a production build on 2026-09-25: every sign-in and sign-up
   * ended at /api/auth/callback/credentials with a 500 and `[auth][error] UntrustedHost`, and no
   * session was ever issued. `next dev` trusts the host implicitly; `next start` does not, and
   * NEXTAUTH_URL alone does not satisfy Auth.js v5's check. The first real sign-up on Render would
   * have hit this.
   *
   * Trusting the Host header is safe here for the same reason TRUSTED_PROXY_HOPS is 1: the app
   * runs behind exactly one platform proxy (Render) that sets Host itself, so it is not
   * client-controlled. Callback and redirect URLs derive from it.
   */
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const rawEmail = credentials?.email;
        const password = credentials?.password;
        if (typeof rawEmail !== "string" || typeof password !== "string") return null;
        // signUp (src/lib/actions/auth.ts) and inviteMember (src/lib/actions/team.ts) both store
        // email lowercased — normalize the same way here, or a user who signed up as
        // "Jane@Firm.com" gets a spurious "Invalid email or password" logging in with different
        // casing than they stored.
        const email = rawEmail.trim().toLowerCase();

        const address = clientAddressFrom(request);

        // Per-address budget first: it spends on every attempt and refuses before any database or
        // password work, so a spray attack costs the server nothing. Safe to hard-refuse because it
        // is not tied to anyone's identity and so cannot be aimed at a particular account.
        if (!addressAttemptAllowed(address)) return null;

        // The focused-guessing budget is only READ here. It counts failures, which is not knowable
        // until after the password has been checked — and the check happens either way, so a
        // refused attempt takes exactly as long as a wrong one.
        const withinGuessBudget = focusedGuessingAllowed(email, address);

        const user = await authPrisma.user.findUnique({ where: { email } });

        // Always pay the bcrypt cost, even when no user matched. Returning early on a missing user
        // made an unknown address answer almost immediately while a known one spent a full bcrypt
        // round (~65ms at cost 10) — a reliable, remotely measurable oracle for whether an address
        // has an account here. Comparing against a fixed hash of a value nothing can equal makes
        // both paths cost the same. The hash is a real bcrypt digest, so the work is genuinely
        // equivalent rather than a sleep standing in for it.
        const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
        const valid = await bcrypt.compare(password, hash);

        if (!user || !valid) {
          // Charge the failure only while there is budget to charge. Once exhausted, further wrong
          // guesses are refused without deepening the hole, which keeps the window from being
          // extended indefinitely by the attacker's own traffic.
          if (withinGuessBudget) recordFailedSignIn(email, address);
          return null;
        }

        if (!withinGuessBudget) return null;

        // A legitimate user who mistyped a few times carries nothing forward once they get in.
        clearFailedSignIns(email, address);
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
