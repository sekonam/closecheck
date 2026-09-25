"use client";

import { useEffect } from "react";

/**
 * Shows a secret exactly once.
 *
 * The API key and the webhook signing secret are handed to the settings page through a short-lived
 * cookie set by the action that minted them, because a server action cannot render and the page
 * cannot receive a return value from it. A Server Component can read that cookie but cannot delete
 * it — cookies are only writable from actions and route handlers — so until this component existed
 * the page showed the plaintext on every render for the cookie's lifetime. "Shown once — store it
 * now. CloseCheck keeps only a hash and cannot show it again" was false for sixty seconds: a reload
 * showed it again, the back button showed it again, a second tab showed it again. Found by the E2E
 * suite reloading the page and finding the key still there.
 *
 * This is the app's first client component, and it does one thing: after the secret has been
 * painted, it calls the action that deletes the cookie, so the NEXT render has nothing to show.
 * With JavaScript off the cookie still expires on its own, which is the previous behaviour, not a
 * regression.
 */
export function RevealOnce({
  title,
  hint,
  value,
  consume,
}: {
  title: string;
  hint: string;
  value: string;
  consume: () => Promise<void>;
}) {
  useEffect(() => {
    void consume();
  }, [consume]);

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">{title}</p>
      <p className="mt-1 break-all font-mono text-xs">{value}</p>
      <p className="mt-1 text-xs text-amber-700">{hint}</p>
    </div>
  );
}
