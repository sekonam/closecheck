import {
  checkRateLimit,
  clearRateLimit,
  clientAddressFrom,
  peekRateLimit,
} from "@/lib/api/rateLimit";

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
 * - **Per email AND address together** (`focusedGuessingAllowed`) counts only FAILED attempts over
 *   a 15-minute window, and is what stops one account being ground down.
 *
 * Why that second key includes the address, rather than being per-email alone: a per-email budget
 * is a weapon. Anyone who knows a victim's address can deliberately burn it with wrong guesses and
 * lock the victim out of their own account for the window. Including the address means an
 * attacker's failures consume the attacker's budget, not the victim's.
 *
 * That property depends entirely on the address not being forgeable, which is why
 * clientAddressFrom() parses X-Forwarded-For against a configured count of trusted proxies rather
 * than taking the leftmost hop. With the leftmost hop, an attacker could present the victim's
 * address and deliberately exhaust that pair's budget — handing back exactly the weapon this design
 * removes. See that function's comment; TRUSTED_PROXY_HOPS must match the deployment.
 *
 * Counting failures rather than attempts, and clearing on success, is what makes the long window
 * safe: a legitimate user who mistypes twice and then succeeds carries nothing forward, so there is
 * no reason to keep the window as short as the API's. Fifteen minutes is far more hostile to slow
 * grinding than one, and costs a real user nothing.
 *
 * Every refusal is invisible. A throttled attempt returns the same null as a wrong password, with
 * no "too many attempts" message — saying that would confirm the address belongs to an account,
 * handing back the enumeration this partly exists to protect.
 */
const DEFAULT_PER_ADDRESS = 30;
const DEFAULT_FAILURES_PER_EMAIL = 10;

/**
 * The failure window, as a real bucket lifetime.
 *
 * An earlier version tried to express this by bucketing the KEY into 15-minute slices of
 * wall-clock time while the shared limiter still expired every bucket after 60 seconds. That did
 * nothing: the limiter's prune deletes a bucket at its resetAt regardless of what the key is
 * called, so the effective window stayed one minute and the real grind rate was 600 failures an
 * hour rather than the 40 the comment claimed. The window has to be a property of the bucket, so
 * it is passed to the limiter explicitly.
 */
const FAILURE_WINDOW_MS = 15 * 60_000;

function budget(envVar: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[envVar] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function failureKey(email: string, address: string): string {
  return `login:fail:${email}:${address}`;
}

function failureOptions() {
  return {
    limit: budget("AUTH_MAX_FAILED_SIGNINS", DEFAULT_FAILURES_PER_EMAIL),
    windowMs: FAILURE_WINDOW_MS,
  };
}

export { clientAddressFrom };

/** Spends from the per-address budget. Call first, before any database or bcrypt work. */
export function addressAttemptAllowed(address: string): boolean {
  return checkRateLimit(`login:addr:${address}`, {
    limit: budget("AUTH_RATE_LIMIT_PER_MINUTE_ADDRESS", DEFAULT_PER_ADDRESS),
  }).allowed;
}

/**
 * Whether this (email, address) pair has any failure budget left. Read-only — call before checking
 * the password, and charge with recordFailedSignIn only if the password turns out to be wrong. The
 * caller must still perform the password comparison even when this returns false, so a refused
 * attempt takes the same time as a wrong one.
 */
export function focusedGuessingAllowed(email: string, address: string): boolean {
  return peekRateLimit(failureKey(email, address), failureOptions());
}

export function recordFailedSignIn(email: string, address: string): void {
  checkRateLimit(failureKey(email, address), failureOptions());
}

export function clearFailedSignIns(email: string, address: string): void {
  clearRateLimit(failureKey(email, address));
}
