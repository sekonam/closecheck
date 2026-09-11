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
    .replace(/\/.*$/, "");
}
