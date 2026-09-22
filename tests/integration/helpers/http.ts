/**
 * HTTP helper for integration specs that exercise the real route handlers over the wire.
 *
 * The §5 launch gate for the Phase 4 API says isolation must be "demonstrated by an actual
 * cross-org request test, not code inspection alone" — so these go through a running server
 * (`npm run dev`), not through an imported route function. Point at a different instance with
 * CLOSECHECK_TEST_BASE_URL when :3000 is taken.
 */
export const BASE_URL = (process.env.CLOSECHECK_TEST_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function serverIsReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/engagements`, {
      signal: AbortSignal.timeout(30_000),
    });
    // Any answer at all proves a server is there; 401 is the expected unauthenticated response.
    return res.status === 401;
  } catch {
    return false;
  }
}

export function apiGet(path: string, token?: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
}
