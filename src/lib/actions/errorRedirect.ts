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
    redirect(`${path}?error=${encodeURIComponent(userFacingMessage(err))}`);
  }
  redirect(path);
}

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Only a message this application wrote on purpose reaches the consultant.
 *
 * Every action here throws a plain `Error` with consultant-facing text when it refuses something
 * ("A Red finding needs a note…"). Anything else that escapes — a Prisma error, a TypeError, a
 * timeout — carries text written for an engineer, and it used to be forwarded verbatim into
 * `?error=` and rendered on the page. Under load during the E2E plan a consultant would have read
 * "Transaction API error: Transaction already closed…" followed by absolute filesystem paths and
 * `.next` chunk names. That is an information leak dressed as an error message, and none of it
 * helps the person reading it. The full error still goes to error_events above; the page gets the
 * one sentence it can act on.
 *
 * The discriminator is the constructor, not the text: subclasses (PrismaClientKnownRequestError,
 * TypeError, AuthError…) are not ours. A belt-and-braces path check catches the one case where a
 * plain Error was constructed around a foreign message.
 */
export function userFacingMessage(err: unknown): string {
  if (!(err instanceof Error) || err.constructor !== Error) return GENERIC_ERROR_MESSAGE;
  const message = err.message.trim();
  if (!message || /\/(Users|home|app|node_modules)\/|\.next\/|\S:\d+:\d+\b|Prisma|Transaction API/i.test(message)) {
    return GENERIC_ERROR_MESSAGE;
  }
  return message;
}
