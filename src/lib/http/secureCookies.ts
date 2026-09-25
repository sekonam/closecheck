/**
 * Whether cookies this application sets should carry the `Secure` flag.
 *
 * "Secure iff the deployment is served over HTTPS" — the same rule Auth.js applies to its own
 * session cookies — rather than "secure iff NODE_ENV is production". The two differ exactly where
 * it hurt: a production build served over plain HTTP, which is what CI's `npm start` on
 * localhost is and what the local E2E recipe in docs/deployment.md is. There the browser silently
 * drops a Secure cookie, and every one-time reveal (a new API key, a webhook signing secret, an
 * invite's temporary password) never renders — two rows of the E2E plan, 2026-09-25. On Render the
 * public URL is https, so nothing changes for a real deployment.
 *
 * Falls back to secure when no public URL is configured in production, because an unknown
 * deployment should fail towards not leaking a secret over plaintext.
 */
export function secureCookies(): boolean {
  // `||`, not `??`: an empty string is "unset" here, and must fall through to the next source.
  const url = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "";
  if (url) return url.startsWith("https://");
  return process.env.NODE_ENV === "production";
}
