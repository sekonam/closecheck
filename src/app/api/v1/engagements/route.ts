import { NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/scoped";
import { authenticateApiRequest, apiUnauthorized } from "@/lib/api/auth";

/**
 * Read-only API, docs/spec.md §13.2. Every route in api/v1 authenticates the bearer token first
 * (cross-org key lookup via the narrow closecheck_api role), then reads through withOrgScope on the
 * normal app client — the API is RLS-enforced end to end, not application-checked.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth) return apiUnauthorized();

  const engagements = await withOrgScope(auth.orgId, (tx) =>
    tx.engagement.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        businessName: true,
        primaryDomain: true,
        dealStage: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  );

  return NextResponse.json({ engagements });
}
