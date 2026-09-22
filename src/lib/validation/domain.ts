import { isPublicHostLiteral, parseIPv4, parseIPv6 } from "@/lib/net/hostSafety";

/**
 * Normalizes user-entered domain input for Engagement.primaryDomain (docs/spec.md §4's Tier A
 * checks need a bare hostname, e.g. "example.com", not a URL). Pulled out as a standalone function
 * — rather than left inline in a zod `.transform()` — specifically so it has its own unit tests
 * (src/lib/validation/domain.test.ts); the zod schemas in src/lib/actions/engagements.ts call this
 * instead of duplicating the regex.
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    // Strip a port and any credentials — "user:pass@example.com:8080/x" must not survive into a
    // stored primaryDomain, where the Tier A runner would interpolate it into a URL.
    .replace(/^[^@/]*@/, "")
    .replace(/:\d+$/, "");
}

/**
 * Is this an acceptable value for `Engagement.primaryDomain`?
 *
 * The Tier A runner makes outbound requests to whatever is stored here and writes what comes back
 * — redirect chains, response headers, CMS fingerprints, TLS certificate subjects — into a Finding
 * the consultant can then read. That makes this field a server-side request forgery vector unless
 * it is constrained, so a host that names something inside the deployment's own network is refused
 * at the point of entry rather than at the point of connection.
 *
 * A bare IP literal is refused even when it is public: this field is the *business's domain*, and
 * every Tier A check (registration record, mail authentication, certificate subject) is meaningless
 * against an address. Refusing the whole shape is both more correct and a smaller attack surface
 * than allow-listing public ranges.
 */
export function validatePrimaryDomain(domain: string): { ok: true } | { ok: false; message: string } {
  if (domain === "") return { ok: true };

  const verdict = isPublicHostLiteral(domain);
  if (!verdict.safe) {
    return { ok: false, message: `That host ${verdict.reason} and cannot be audited.` };
  }
  if (parseIPv4(domain) !== null || parseIPv6(domain) !== null) {
    return {
      ok: false,
      message: "Enter the business's domain name rather than an IP address — the Tier A checks all read domain-level records.",
    };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return { ok: false, message: "That doesn't look like a domain name (for example: example-restaurant.com)." };
  }
  return { ok: true };
}
