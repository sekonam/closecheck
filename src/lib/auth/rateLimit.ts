import { checkRateLimit, clearRateLimit, peekRateLimit } from "@/lib/api/rateLimit";

/**
 * Sign-in attempt budgets.
 *
 * There was no limit of any kind on password attempts: an attacker who knew an address could grind
 * it as fast as the server would answer. That matters more here than in most products because
 * User.email is unique platform-wide (see the enumeration note in src/lib/actions/team.ts) — the
 * same design decision that makes a per-email budget meaningful is what makes an address worth
 * confirming in the first place.
 *
 * TWO BUDGETS, KEYED DIFFERENTLY ON PURPOSE
 *
 * - **Per client address** (`addressAttemptAllowed`) counts every attempt and refuses BEFORE any
 *   password work happens. It catches the spray attack a per-email budget cannot see — one guess
 *   each against a thousand addresses — and it is safe to hard-refuse because it is not tied to any
 *   individual's identity, so it cannot be aimed at a specific victim.
 *
 * - **Per email AND address together** (`focusedGuessingAllowed`) counts only FAILED attempts, and
 *   is what stops one account being ground down.
 *
 * Why that second key includes the address, rather than being per-email alone: a per-email budget
 * is a weapon. Anyone who knows a victim's address can deliberately burn it with wrong guesses and
 * lock the victim out of their own account for the window. Including the address in the key means
 * an attacker's failures consume the attacker's budget, not the victim's — the victim signing in
 * from anywhere else is unaffected. An attacker who does share the victim's address is already
 * spending the per-address budget too.
 *
 * Counting failures rather than attempts, and clearing on success, is what makes the window safe to
 * lengthen: a legitimate user who mistypes twice and then succeeds carries nothing forward, so
 * there is no reason to keep the window as short as the API's. Fifteen minutes is far more hostile
 * to slow grinding than one and costs a real user nothing.
 *
 * Every refusal is invisible. A throttled attempt returns the same null as a wrong password, with
 * no "too many attempts" message — saying that would confirm the address belongs to an account,
 * handing back the enumeration this partly exists to protect.
 */
const DEFAULT_PER_ADDRESS = 30;
const DEFAULT_FAILURES_PER_EMAIL = 10;

/** The failure counter's window, in minutes, expressed as a limit against the shared one-minute
 * limiter: a 15-minute window is modelled by charging each failure to a 15-minute-wide key. */
const FAILURE_WINDOW_MINUTES = 15;

function budget(envVar: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[envVar] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The shared limiter's window is one minute. Bucketing the key by a coarser slice of wall-clock
 * time gives the failure counter a longer effective window without a second limiter: all failures
 * inside the same 15-minute slice share one key. The seam between slices can let an attacker have
 * two budgets back to back, which is the same fixed-window imprecision the API limiter accepts and
 * for the same reason — this is a guess budget, not a fairness guarantee.
 */
function failureKey(email: string, address: string): string {
  const slice = Math.floor(Date.now() / (FAILURE_WINDOW_MINUTES * 60_000));
  return `login:fail:${slice}:${email}:${address}`;
}

/** Normalizes the address the same way for every key, so one client is one bucket. */
export function clientAddressFrom(request: Request | undefined): string {
  if (!request) return "unknown";
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown"
  );
}

/** Spends from the per-address budget. Call first, before any database or bcrypt work. */
export function addressAttemptAllowed(address: string): boolean {
  return checkRateLimit(
    `login:addr:${address}`,
    Date.now(),
    budget("AUTH_RATE_LIMIT_PER_MINUTE_ADDRESS", DEFAULT_PER_ADDRESS),
  ).allowed;
}

/**
 * Whether this (email, address) pair has any failure budget left. Read-only — call before checking
 * the password, and charge with recordFailedSignIn only if the password turns out to be wrong. The
 * caller must still perform the password comparison even when this returns false, so a refused
 * attempt takes the same time as a wrong one.
 */
export function focusedGuessingAllowed(email: string, address: string): boolean {
  return peekRateLimit(
    failureKey(email, address),
    Date.now(),
    budget("AUTH_MAX_FAILED_SIGNINS", DEFAULT_FAILURES_PER_EMAIL),
  );
}

export function recordFailedSignIn(email: string, address: string): void {
  checkRateLimit(
    failureKey(email, address),
    Date.now(),
    budget("AUTH_MAX_FAILED_SIGNINS", DEFAULT_FAILURES_PER_EMAIL),
  );
}

export function clearFailedSignIns(email: string, address: string): void {
  clearRateLimit(failureKey(email, address));
}
