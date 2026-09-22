import { redirect, unstable_rethrow } from "next/navigation";
import { recordError } from "@/lib/metrics/record";

/**
 * Runs a Server Action and, on failure, redirects to `path` with the error message in a query
 * param. Every server action in this app validates via safeParse and throws a clean Error (see the
 * safeParse-hardening convention across src/lib/actions/*.ts) — but a thrown Error reaching Next
 * with no catch crashes the request to the default error boundary instead of showing that message.
 * src/app/login/page.tsx and src/app/signup/page.tsx already wrap their actions this way; this is
 * the same shape factored out so every other page's forms can do the same without repeating the
 * try/catch/redirect boilerplate at every one of them.
 *
 * unstable_rethrow runs first so Next's own control-flow signals (a redirect/notFound thrown by the
 * action itself, e.g. signIn()'s redirectTo or createAudit's redirect to the new audit page) pass
 * through untouched rather than being caught here and misrouted to an error message.
 *
 * On success, explicitly redirects back to the plain `path` (no query string) rather than letting
 * the request fall through with no navigation — otherwise a page whose URL still carries an
 * `?error=...` from a previous failed submission keeps showing that stale error after a later
 * submission succeeds, since nothing would otherwise change the URL.
 */
export async function runOrRedirect(action: () => Promise<void>, path: string): Promise<void> {
  try {
    await action();
  } catch (err) {
    unstable_rethrow(err);
    // Phase 2.5 error tracking: every server-action failure that reaches a user as an error message
    // also lands in error_events. Fire-and-forget — recording must never delay or alter the redirect.
    void recordError("server-action", err);
    const message = err instanceof Error ? err.message : "Something went wrong.";
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  redirect(path);
}
