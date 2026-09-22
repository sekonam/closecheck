"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { withOrgScope, type ScopedTx } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";
import { isDeliverableWebhookUrl } from "@/lib/webhooks/dispatch";

/** Owner-only for the same reason as API keys: an endpoint receives org-lifecycle events. */
async function requireOwner(tx: ScopedTx, userId: string): Promise<void> {
  const caller = await tx.user.findUnique({ where: { id: userId } });
  if (!caller) {
    throw new Error("Your account could not be found.");
  }
  if (caller.role !== "OWNER") {
    throw new Error("Only the account owner can manage webhook endpoints.");
  }
}

const addWebhookSchema = z.object({
  url: z.string().trim().url("Enter a valid URL.").max(2000, "URL is too long."),
});

export async function addWebhookEndpoint(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgSession();

  const result = addWebhookSchema.safeParse({ url: formData.get("url") });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid URL.");
  }
  if (!isDeliverableWebhookUrl(result.data.url)) {
    throw new Error("Webhook URLs must be https:// and publicly reachable (no localhost or private-network hosts).");
  }

  // The signing secret the receiver verifies deliveries with (spec.md §13.3). Stored as-is — the
  // WebhookEndpoint model comment explains why it cannot be hashed — and shown to the owner once
  // via the same short-lived-cookie pattern as API keys.
  const secret = "whsec_" + randomBytes(32).toString("base64url");

  await withOrgScope(orgId, async (tx) => {
    await requireOwner(tx, userId);
    await tx.webhookEndpoint.create({ data: { orgId, url: result.data.url, secret } });
  });

  const cookieStore = await cookies();
  cookieStore.set("closecheck_new_webhook_secret", secret, {
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

export async function deleteWebhookEndpoint(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgSession();

  const result = z.string().min(1).safeParse(formData.get("webhookEndpointId"));
  if (!result.success) {
    throw new Error("Missing or invalid webhookEndpointId.");
  }

  await withOrgScope(orgId, async (tx) => {
    await requireOwner(tx, userId);
    const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: result.data } });
    if (!endpoint) {
      throw new Error("That webhook endpoint could not be found.");
    }
    await tx.webhookEndpoint.delete({ where: { id: endpoint.id } });
  });

  revalidatePath("/settings");
}
