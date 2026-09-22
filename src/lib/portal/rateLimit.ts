import { checkRateLimit, clientAddressFrom } from "@/lib/api/rateLimit";

/**
 * Rate limiting for the client portal (docs/spec.md §7).
 *
 * The portal is the only unauthenticated WRITE path in the product: every access writes a
 * `portal_access_log` row and a `metric_events` row, and the PDF route additionally serves a
 * multi-hundred-kilobyte document. Nothing limited it — forty parallel requests produced forty log
 * rows, forty metric rows and forty full PDF bodies. That is a resource problem, and it is also an
 * evidence-quality problem: the access trail is a §8 feature a consultant points at when a buyer's
 * advisory team asks who has had access, and an unbounded trail is a less useful one.
 *
 * WHAT THIS IS NOT FOR. It is not access control. The token is the credential, it carries real
 * entropy, and an unknown token is already indistinguishable from a revoked or expired one at the
 * database layer. This exists so that holding a link does not also mean being able to spend the
 * deployment's bandwidth and fill a consultant's access history.
 *
 * TWO BUDGETS, and the second one is deliberately allowed to be absent.
 *
 * - **Per token.** The primary limit, and the one that is safe to enforce unconditionally: a token
 *   identifies one shared report, so exhausting its budget affects only the people holding that
 *   link. An attacker who can do that already has the link.
 * - **Per client address, only when the address is real.** Skipped entirely when
 *   `clientAddressFrom` returns "unknown", which is what every caller resolves to on a deployment
 *   with no trusted proxy. Blocking on an identity every caller shares would take the whole portal
 *   offline for one host's traffic — the same mistake made in sign-in, where exempting only one of
 *   two budgets then reinstated a different failure. Enumerated deliberately this time: with the
 *   address absent, the per-token budget still bounds each link, and the portal's exposure is
 *   bounded by the number of live links rather than being unbounded.
 *
 * Limits are generous because the legitimate pattern is a buyer's advisory team, often behind one
 * corporate address, opening a page that then fetches its own PDF.
 */
const DEFAULT_PER_TOKEN = 60;
const DEFAULT_PER_ADDRESS = 120;

function budget(envVar: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[envVar] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type PortalRateVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function portalRequestAllowed(headers: Headers, token: string): PortalRateVerdict {
  // Keyed on the token, not on anything derived from it: this is a bucket name, and the token is
  // already the credential. It never leaves the process.
  const perToken = checkRateLimit(`portal:token:${token}`, {
    limit: budget("PORTAL_RATE_LIMIT_PER_MINUTE_TOKEN", DEFAULT_PER_TOKEN),
  });
  if (!perToken.allowed) {
    return { allowed: false, retryAfterSeconds: perToken.retryAfterSeconds };
  }

  const address = clientAddressFrom({ headers } as Request);
  if (address === "unknown") return { allowed: true };

  const perAddress = checkRateLimit(`portal:addr:${address}`, {
    limit: budget("PORTAL_RATE_LIMIT_PER_MINUTE_ADDRESS", DEFAULT_PER_ADDRESS),
  });
  if (!perAddress.allowed) {
    return { allowed: false, retryAfterSeconds: perAddress.retryAfterSeconds };
  }
  return { allowed: true };
}
