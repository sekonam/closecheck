"use client";

import Link from "next/link";

/**
 * Error boundary for the signed-in app. Everyone who reaches it has an account, so unlike the
 * audience-neutral root boundary (src/app/error.tsx, which also covers the buyer-facing portal) it
 * can offer a way back into the product.
 *
 * Most failures in this product never reach here: server actions go through `runOrRedirect`, which
 * turns a refusal into a readable sentence on the page it came from, and a missing or cross-tenant
 * id becomes `notFound()` and renders not-found.tsx. What lands here is the genuinely unexpected —
 * and the consultant hitting it may be mid-audit on a live deal, so it says what is safe (their
 * saved work) and offers a way forward rather than an apology.
 *
 * It deliberately shows NO error text, stack or digest-as-explanation. A consultant cannot act on a
 * stack trace, and this application's own rule is that raw exception text never reaches a user
 * (src/lib/actions/errorRedirect.ts makes the same decision for action failures, after a real leak
 * of Prisma internals and absolute paths into a visible banner). The digest is rendered only as an
 * opaque reference the founder can match against the server log, which is where Next has already
 * recorded the real error and its stack.
 *
 * No reporting call is made from here on purpose. Shipping one would mean an unauthenticated
 * endpoint that writes rows on request, which is a larger surface than the problem justifies — and
 * a reporter that throws inside an error boundary turns a recoverable page into a blank one.
 */
export default function SignedInError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-sev-amber-border bg-sev-amber-bg text-base text-sev-amber"
        >
          !
        </span>
        <h1 className="mt-4 text-lg font-semibold text-ink-900">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          This page could not be loaded. Nothing you had already saved has been lost — findings,
          evidence and reports are written as you go.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-ink-900 px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-ink-800"
          >
            Try again
          </button>
          <Link
            href="/engagements"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-ink-300 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 shadow-xs transition-colors hover:bg-ink-50"
          >
            Back to Engagements
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-6 border-t border-ink-200 pt-4 font-mono text-[11px] text-ink-400">
            Reference {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
