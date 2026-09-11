"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrgScope } from "@/lib/db/scoped";
import { requireOrgSession } from "@/lib/auth/session";

const createEngagementSchema = z.object({
  businessName: z.string().min(1, "Business name is required"),
  primaryDomain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .optional(),
});

export async function createEngagement(formData: FormData) {
  const { orgId } = await requireOrgSession();

  const parsed = createEngagementSchema.parse({
    businessName: formData.get("businessName"),
    primaryDomain: formData.get("primaryDomain") || undefined,
  });

  const engagement = await withOrgScope(orgId, (tx) =>
    tx.engagement.create({
      data: {
        orgId,
        businessName: parsed.businessName,
        primaryDomain: parsed.primaryDomain || null,
      },
    }),
  );

  revalidatePath("/engagements");
  redirect(`/engagements/${engagement.id}`);
}
