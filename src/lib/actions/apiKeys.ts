"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { withOrgScope, type ScopedTx } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { generateApiToken } from "@/lib/api/auth";

/**
 * API key management, docs/spec.md §13.2 — owner-only, same reasoning as team management
 * (src/lib/actions/team.ts): a key grants read access to everything in the org, which is not a
 * MEMBER-level decision to hand out.
 */
async function requireOwner(tx: ScopedTx, userId: string): Promise<void> {
  const caller = await tx.user.findUnique({ where: { id: userId } });
  if (!caller) {
    throw new Error("Your account could not be found.");
  }
  if (caller.role !== "OWNER") {
    throw new Error("Only the account owner can manage API keys.");
  }
}

const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the key a name so it stays identifiable.")
    .max(100, "Key name is too long."),
});

export async function createApiKey(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgSession();

  const result = createApiKeySchema.safeParse({ name: formData.get("name") });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid key name.");
  }

  const { token, tokenHash, tokenPrefix } = generateApiToken();

  await withOrgScope(orgId, async (tx) => {
    await requireOwner(tx, userId);
    await tx.apiKey.create({
      data: { orgId, name: result.data.name, tokenHash, tokenPrefix },
    });
  });

  // One-time display via a short-lived cookie, exactly like team.ts's temp-password relay: the
  // settings page shows it once and it self-clears. The plaintext token is never persisted anywhere
  // server-side — only its hash was stored above.
  const cookieStore = await cookies();
  cookieStore.set("closecheck_new_api_key", token, {
    maxAge: 60,
    httpOnly: true,
    sameSite: "lax",
    // These three flags matter because the value IS the secret, in cleartext, for 60 seconds:
    // `secure` keeps it off any plaintext hop on a deployment that isn't strictly HTTPS-only
    // (relaxed outside production so local http://localhost development still works), and the path
    // scope stops it riding along on every unrelated request — the settings page is the only thing
    // that ever reads it. httpOnly keeps it out of page JS, which has no reason to see it.
    secure: process.env.NODE_ENV === "production",
    path: "/settings",
  });

  revalidatePath("/settings");
}

/**
 * Deletes the one-time reveal cookies once the settings page has painted them. Called by the
 * RevealOnce client component on mount; see its docstring for why a Server Component cannot do
 * this itself. Deleting both is deliberate — a page that shows one secret has shown its render.
 */
export async function consumeSecretReveals(): Promise<void> {
  const cookieStore = await cookies();
  for (const name of ["closecheck_new_api_key", "closecheck_new_webhook_secret"]) {
    cookieStore.set(name, "", { maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/settings" });
  }
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgSession();

  const result = z.string().min(1).safeParse(formData.get("apiKeyId"));
  if (!result.success) {
    throw new Error("Missing or invalid apiKeyId.");
  }

  await withOrgScope(orgId, async (tx) => {
    await requireOwner(tx, userId);
    // findUnique-then-check, not updateOrThrow: a foreign-org id resolves to zero rows under RLS and
    // must fail with a clean message (established convention).
    const key = await tx.apiKey.findUnique({ where: { id: result.data } });
    if (!key) {
      throw new Error("That API key could not be found.");
    }
    if (key.revokedAt) {
      return; // already revoked — idempotent, nothing to do
    }
    await tx.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  });

  revalidatePath("/settings");
}
