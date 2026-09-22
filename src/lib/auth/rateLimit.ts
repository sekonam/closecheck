import { createHash } from "node:crypto";
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

/**
 * Both components are hashed into the key rather than interpolated raw, for two reasons that only
 * became visible when the "derived keys are access-control decisions" lens was applied to them.
 *
 * **The separator was ambiguous.** `${email}:${address}` is not injective when either part can
 * contain a colon — and both can: IPv6 addresses are full of them, and `authorize()` does no format
 * validation whatsoever on the submitted email before it reaches here, so an attacker chooses that
 * string freely. Two different (email, address) pairs producing one key means two identities
 * sharing one budget, which is the same class of defect as a vendor-name normaliser collapsing two
 * companies onto one profile: the database can enforce nothing, because the key is computed a layer
 * above anything it can see.
 *
 * **The email was unbounded.** An unvalidated string goes straight into a Map key, so a caller
 * could submit a multi-megabyte "email" and spend the limiter's own memory. The key cap bounds the
 * number of entries, not their size.
 *
 * A fixed-width digest of each component removes both at once. The hash is not a security boundary
 * — it is not protecting the email from anyone, since the value never leaves this process — it
 * exists purely to make the key injective and fixed-length. Truncation to 32 hex characters is
 * ample: a collision here costs a shared guess budget, not disclosure.
 */
function keyComponent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function failureKey(email: string, address: string): string {
  return `login:fail:${keyComponent(email)}:${keyComponent(address)}`;
}

function failureOptions() {
  return {
    limit: budget("AUTH_MAX_FAILED_SIGNINS", DEFAULT_FAILURES_PER_EMAIL),
    windowMs: FAILURE_WINDOW_MS,
  };
}

export { clientAddressFrom };

/**
 * Spends from the per-address budget. Call first, before any database or bcrypt work.
 *
 * Returns true unconditionally when the address is unknown, and that is deliberate. An unknown
 * address means every anonymous caller shares one bucket — which is fine for the API limiter, where
 * exhausting it costs the caller their own requests, and catastrophic here, where this budget
 * HARD-REJECTS before the password is checked. Thirty requests a minute from a single host would
 * make sign-in return null for every user on the deployment: a one-line denial of service against
 * the whole product. That is reachable whenever TRUSTED_PROXY_HOPS is 0, and for any individual
 * request arriving without the expected headers.
 *
 * So when the address carries no information, this budget simply does not apply. Anti-spray
 * protection genuinely is lost in that configuration — an operator running without a proxy cannot
 * have address-based limiting, because there is no trustworthy address — but the focused
 * (email, address) failure budget still bounds guessing against any one account, which is the
 * property that actually protects users.
 */
export function addressAttemptAllowed(address: string): boolean {
  if (address === "unknown") return true;
  return checkRateLimit(`login:addr:${keyComponent(address)}`, {
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
  // Same exemption as the address budget, and for a reason I got wrong the first time. This budget
  // is keyed on (email, address) precisely so an attacker's failures spend the attacker's budget
  // rather than the victim's. When the address is unknown it is unknown for EVERYONE, so the key
  // collapses to per-email — and a per-email budget that blocks is the victim-lockout weapon this
  // whole design exists to remove. Exempting only the address budget fixed the denial of service
  // and silently reinstated the lockout; verified by driving it, not by reading it.
  //
  // So with no trustworthy client identity there is no sign-in rate limiting at all. That is the
  // honest position rather than a gap: any blocking keyed on an identity every caller shares is
  // collective punishment, and the choice is between locking out real users and not limiting. Do
  // not run TRUSTED_PROXY_HOPS=0 in production — docs/deployment.md says so at the step that sets
  // it. Failures are still recorded, so the founder can see grinding even where it cannot be
  // blocked.
  if (address === "unknown") return true;
  return peekRateLimit(failureKey(email, address), failureOptions());
}

export function recordFailedSignIn(email: string, address: string): void {
  checkRateLimit(failureKey(email, address), failureOptions());
}

export function clearFailedSignIns(email: string, address: string): void {
  clearRateLimit(failureKey(email, address));
}
