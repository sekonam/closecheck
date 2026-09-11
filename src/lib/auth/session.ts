import { auth } from "./config";

/**
 * The single chokepoint every server component/route handler should call before touching tenant
 * data. Throws rather than returning null/undefined for "no session" so a caller can't accidentally
 * proceed with an empty orgId and hand it to withOrgScope (which would then scope to nothing, per
 * its own guard against an empty orgId — this is the layer above that, giving a clearer error).
 */
export async function requireOrgSession() {
  const session = await auth();
  if (!session?.user?.orgId) {
    throw new Error("UNAUTHENTICATED");
  }
  return { orgId: session.user.orgId, userId: session.user.id as string, email: session.user.email as string };
}
