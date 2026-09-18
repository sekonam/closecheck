"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";

const inviteMemberSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  name: z.string().trim().optional(),
});

/** Generates a temporary password the invited teammate uses for their first sign-in. There is no
 * email-sending infrastructure in this codebase — this is an explicit placeholder for a real
 * invite-by-email flow (docs/roadmap.md Phase 2's "team-tier multi-seat support"): the owner sees it
 * once (via the short-lived cookie below) and has to relay it to the invitee themselves. */
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

  await withOrgScope(orgId, async (tx) => {
    const caller = await tx.user.findUnique({ where: { id: userId } });
    if (!caller) {
      throw new Error("Your account could not be found.");
    }
    if (caller.role !== "OWNER") {
      throw new Error("Only the account owner can invite teammates.");
    }

    try {
      await tx.user.create({
        data: { orgId, email, name: name ?? null, passwordHash, role: "MEMBER" },
      });
    } catch (err) {
      // Prisma's unique-constraint error (P2002) on email — surface a clean message instead of the
      // raw constraint violation, matching this session's established error-handling convention.
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        throw new Error("That email is already in use.");
      }
      throw err;
    }
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
      const ownerCount = await tx.user.count({ where: { orgId, role: "OWNER" } });
      if (ownerCount <= 1) {
        throw new Error("Can't remove the only owner on the account.");
      }
    }

    await tx.user.delete({ where: { id: targetUserId } });
  });

  revalidatePath("/settings");
}
