import { redirect } from "next/navigation";
import { auth } from "./config";
import { withOrgScope } from "@/lib/db/scoped";

/**
 * The single chokepoint every server component/route handler should call before touching tenant
 * data. Throws rather than returning null/undefined for "no session" so a caller can't accidentally
 * proceed with an empty orgId and hand it to withOrgScope (which would then scope to nothing, per
 * its own guard against an empty orgId — this is the layer above that, giving a clearer error).
 *
 * Also confirms the user row backing the JWT still exists. Sessions are stateless JWTs
 * (src/lib/auth/config.ts, strategy: "jwt") with no server-side revocation list, so deleting a
 * User (src/lib/actions/team.ts's removeMember) does nothing to a cookie already issued to them —
 * without this check, a removed teammate keeps full read/write access to the org's data until their
 * token happens to expire. Costs one extra query per request; every page/action here already makes
 * several withOrgScope round trips, so this isn't a new order of overhead.
 */
export async function requireOrgSession() {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.id) {
    redirect("/login");
  }
  const orgId = session.user.orgId;
  const userId = session.user.id;

  const stillExists = await withOrgScope(orgId, (tx) => tx.user.findUnique({ where: { id: userId } }));
  if (!stillExists) {
    redirect("/login");
  }

  return { orgId, userId, email: session.user.email as string };
}
