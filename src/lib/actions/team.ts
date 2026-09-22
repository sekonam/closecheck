"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email/send";
import { teamInvite } from "@/lib/email/templates";

const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  name: z.string().trim().optional(),
});

/** Generates a temporary password the invited teammate uses for their first sign-in. Email
 * infrastructure now exists (src/lib/email/send.ts, Phase 2.5) and the invite IS emailed below —
 * but the short-lived-cookie relay stays as the guaranteed path: with no RESEND_API_KEY configured
 * the email is only LOGGED, and even with one configured, delivery is best-effort while the cookie
 * is synchronous and certain. */
function generateTempPassword(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Only an OWNER can invite a teammate. requireOrgSession() doesn't carry role (it's the pre-org-scope
 * auth chokepoint, not a full profile read), so look the caller's own row up first — this read is
 * scoped to their own org like everything else, not a special case.
 */
export async function inviteMember(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgSession();

  const result = inviteMemberSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") || undefined,
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid invite input.");
  }
  const { email, name } = result.data;

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const { inviterName, orgName } = await withOrgScope(orgId, async (tx) => {
    const caller = await tx.user.findUnique({ where: { id: userId } });
    if (!caller) {
      throw new Error("Your account could not be found.");
    }
    if (caller.role !== "OWNER") {
      throw new Error("Only the account owner can invite teammates.");
    }
    const org = await tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } });

    try {
      await tx.user.create({
        data: { orgId, email, name: name ?? null, passwordHash, role: "MEMBER" },
      });
    } catch (err) {
      // Prisma's unique-constraint error (P2002) on email — surface a clean message instead of the
      // raw constraint violation, matching this session's established error-handling convention.
      //
      // Known, accepted limitation: User.email is unique platform-wide, not per-org, so this error
      // also fires when the email belongs to a DIFFERENT org — letting an OWNER probe whether an
      // arbitrary email is a CloseCheck customer anywhere, not just within their own firm. Closing
      // this fully would mean either a per-org-scoped email uniqueness model or a real
      // invite-by-email flow (no synchronous temp-password relay) so a "we sent an invite" message
      // can be shown unconditionally — both bigger changes than this pass. Accepted for now, on the
      // same footing as signup's own "email already exists" check (src/lib/actions/auth.ts), which
      // has an identical (single-email, self-directed) enumeration shape.
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        throw new Error("That email is already in use.");
      }
      throw err;
    }

    return { inviterName: caller.name || caller.email, orgName: org.name };
  });

  // Best-effort by design (sendEmail never throws) — the member row is committed above, and the
  // cookie relay below remains the guaranteed way the invitee gets their password.
  const invite = teamInvite({ inviterName, orgName, email, tempPassword });
  await sendEmail({
    orgId,
    to: email,
    subject: invite.subject,
    template: "team-invite",
    html: invite.html,
    text: invite.text,
  });

  // One-time display only: a 60-second cookie is enough time for the owner to copy the password and
  // relay it, and naturally clears itself without needing a separate "dismiss" action from a Server
  // Component (which can't delete cookies during render, only inside an action/route handler).
  const cookieStore = await cookies();
  cookieStore.set("closecheck_invite_temp_password", `${email}:${tempPassword}`, {
    maxAge: 60,
    // The settings page reads this server-side via cookies() — that works identically regardless of
    // httpOnly, since the flag only controls whether browser-side JS (document.cookie) can read it,
    // not whether the server can. No reason to also expose a temporary password to page JS.
    httpOnly: true,
    sameSite: "lax",
  });

  revalidatePath("/settings");
}

/**
 * Only an OWNER can remove a teammate, and never the last remaining OWNER — that would lock everyone
 * out of the org's own account with no recovery path, a real preventable bug, not just a nicety.
 */
export async function removeMember(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgSession();

  const result = z.string().min(1).safeParse(formData.get("userId"));
  if (!result.success) {
    throw new Error("Missing or invalid userId.");
  }
  const targetUserId = result.data;

  await withOrgScope(orgId, async (tx) => {
    const caller = await tx.user.findUnique({ where: { id: userId } });
    if (!caller) {
      throw new Error("Your account could not be found.");
    }
    if (caller.role !== "OWNER") {
      throw new Error("Only the account owner can remove teammates.");
    }

    const target = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!target) {
      throw new Error("That teammate could not be found.");
    }

    if (target.role === "OWNER") {
      // FOR UPDATE locks the org's OWNER rows for the rest of this transaction — without it, two
      // concurrent "remove the other owner" requests (one from each of an org's two owners) could
      // both read ownerCount === 2, both pass this check, and both commit, leaving the org with zero
      // owners and no recovery path. The second transaction here blocks until the first commits or
      // rolls back, then re-reads a now-correct count.
      // Postgres rejects FOR UPDATE combined with an aggregate (count(*)) — select the row ids
      // themselves and count them in JS instead.
      const owners = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE "orgId" = ${orgId} AND role = 'OWNER' FOR UPDATE
      `;
      if (owners.length <= 1) {
        throw new Error("Can't remove the only owner on the account.");
      }
    }

    await tx.user.delete({ where: { id: targetUserId } });
  });

  revalidatePath("/settings");
}
