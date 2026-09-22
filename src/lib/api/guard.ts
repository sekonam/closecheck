import { NextResponse } from "next/server";
import { authenticateApiRequest, apiUnauthorized, type ApiAuthResult } from "./auth";
import {
  apiRateLimitOptions,
  apiTooManyRequests,
  checkRateLimit,
  rateLimitHeaders,
  rateLimitKeyForRequest,
} from "./rateLimit";

/**
 * The single entry gate every /api/v1 route goes through: authenticate, then budget.
 *
 * Ordering is deliberate and is the opposite of the obvious one. Rate limiting before
 * authentication would have to be keyed on the client address, which is the only identity available
 * that early — and that punishes exactly the wrong people, because a firm's integration running
 * behind corporate NAT shares one address with every other client on it. So authentication runs
 * first (one indexed lookup on a unique hash column, cheap enough to spend on an unauthenticated
 * request), and then:
 *
 * - an authenticated request is budgeted against its own API KEY, so one firm's runaway script
 *   cannot spend another firm's allowance — the same per-tenant reasoning the rest of the API is
 *   built on;
 * - a failed request is budgeted against its ADDRESS, which bounds anonymous abuse without ever
 *   touching a legitimate client's budget.
 *
 * A caller that keeps presenting a bad token therefore gets 429 rather than an endless supply of
 * 401s, while a caller with a valid key is never throttled by a stranger sharing its NAT.
 */
export type ApiGuardResult =
  | { ok: true; auth: ApiAuthResult; headers: Record<string, string> }
  | { ok: false; response: NextResponse };

export async function guardApiRequest(request: Request): Promise<ApiGuardResult> {
  const auth = await authenticateApiRequest(request);

  if (!auth) {
    const anonymous = checkRateLimit(rateLimitKeyForRequest(request), apiRateLimitOptions());
    if (!anonymous.allowed) return { ok: false, response: apiTooManyRequests(anonymous) };
    return { ok: false, response: apiUnauthorized() };
  }

  const budget = checkRateLimit(rateLimitKeyForRequest(request, auth.apiKeyId), apiRateLimitOptions());
  if (!budget.allowed) return { ok: false, response: apiTooManyRequests(budget) };

  return { ok: true, auth, headers: rateLimitHeaders(budget) };
}

/** Attaches the caller's remaining budget to a successful response, so a client can pace itself
 * instead of discovering the limit by hitting it. */
export function apiJson(body: unknown, headers: Record<string, string>): NextResponse {
  return NextResponse.json(body, { headers });
}
