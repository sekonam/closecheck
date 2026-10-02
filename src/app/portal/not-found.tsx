/**
 * Not-found boundary scoped to /portal/* — the only 404 a BUYER can reach.
 *
 * The root boundary (src/app/not-found.tsx) is already brandless, but its single control is "Back
 * to Engagements", which lands on "Sign in to your consultant account". So a buyer following a dead
 * or revoked link was walked straight into the consultant's tooling: the exact outcome spec.md §2
 * principle 4 exists to prevent, and a reputational problem for the firm whose link it was. This
 * segment boundary wins over the root one for anything under /portal, and offers no way into the
 * product at all.
 *
 * The wording deliberately does NOT distinguish "revoked" from "expired" from "never existed" —
 * page.tsx's resolver makes the same choice for the same reason, since telling an ex-buyer which
 * one it was leaks more than a link's existence should. It points at the firm instead, matching the
 * sibling "Report not ready" state a buyer may also land on.
 */
export default function PortalNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-lg border border-ink-200 bg-white px-6 py-8 text-center shadow-xs">
        <span
          aria-hidden="true"
          className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-400"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8V7a6 6 0 1 0-12 0v1" />
            <rect x="4" y="8" width="16" height="12" rx="2" />
          </svg>
        </span>
        <h1 className="mt-5 text-xl font-semibold text-ink-900">This link is no longer available</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          It may have been withdrawn, or it may have expired. Please contact the firm that shared
          this link with you.
        </p>
      </div>
    </div>
  );
}
