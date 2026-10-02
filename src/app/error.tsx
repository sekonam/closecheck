"use client";

/**
 * Error boundary for everything OUTSIDE the signed-in app: /login, /signup, /pricing, and — the
 * reason this file is deliberately audience-neutral — /portal/<token>.
 *
 * A buyer with no CloseCheck account can land here. So this boundary offers no navigation into the
 * product, names no firm, and carries no CloseCheck wordmark: the same reasoning not-found.tsx
 * already applies, for the same reason. The signed-in equivalent at (app)/error.tsx is free to be
 * more helpful because everyone who reaches it has an account.
 *
 * It shows NO error text, stack or digest-as-explanation. Raw exception text never reaches a user
 * in this application (src/lib/actions/errorRedirect.ts made the same call for action failures,
 * after Prisma internals and absolute paths leaked into a visible banner). The digest is rendered
 * only as an opaque reference that matches the server log, where Next has already recorded the
 * real error and its stack.
 *
 * No reporting call is made from here on purpose: shipping one would mean an unauthenticated
 * endpoint that writes rows on request, and a reporter that throws inside an error boundary turns
 * a recoverable page into a blank one.
 */
export default function RootError({
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
          This page could not be loaded. Try again in a moment.
        </p>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-ink-900 px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-ink-800"
          >
            Try again
          </button>
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
