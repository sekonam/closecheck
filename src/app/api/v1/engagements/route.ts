import { withOrgScope } from "@/lib/db/scoped";
import { guardApiRequest, apiJson } from "@/lib/api/guard";

/**
 * Read-only API, docs/spec.md §13.2. Every route in api/v1 goes through guardApiRequest (bearer
 * auth via the narrow closecheck_api role, then per-key rate limiting), then reads through
 * withOrgScope on the normal app client — the API is RLS-enforced end to end, not
 * application-checked.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Cursor pagination, not offset. This endpoint previously returned every engagement an org had ever
 * created in one unbounded response, which gets slower and heavier for exactly the firms who adopt
 * the product most — the ones the API exists for. A cursor is also stable under concurrent writes
 * in a way OFFSET is not: a new engagement created mid-pagination shifts every offset by one and
 * silently skips a row, while a cursor anchored to an id cannot.
 */
export async function GET(request: Request) {
  const guard = await guardApiRequest(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
  const cursor = url.searchParams.get("cursor");

  // One extra row, discarded before serializing, is how "is there another page" is answered without
  // a second COUNT query over the whole table.
  const rows = await withOrgScope(guard.auth.orgId, (tx) =>
    tx.engagement.findMany({
      take: limit + 1,
      // A cursor from another org resolves to nothing under RLS rather than leaking the existence
      // of that id, so no separate ownership check is needed here.
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

  const hasMore = rows.length > limit;
  const engagements = hasMore ? rows.slice(0, limit) : rows;

  return apiJson(
    {
      engagements,
      // Null rather than omitted: a client can loop `while (nextCursor)` without having to
      // distinguish "no more pages" from "field I forgot to handle".
      nextCursor: hasMore ? (engagements[engagements.length - 1]?.id ?? null) : null,
    },
    guard.headers,
  );
}
