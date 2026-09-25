"use client";

import { useEffect, useState } from "react";

/**
 * Shows a just-minted secret exactly once, and survives the refresh that showing it triggers.
 *
 * The secret travels from the action to this page in a short-lived cookie the Server Component
 * reads but cannot delete (a Server Component cannot set cookies during render), so this component
 * calls an action on mount to expire it. That call is the trap: invoking a server action makes
 * Next re-render the route, the re-render finds no cookie, the parent stops passing `value`, and
 * the first version of this component — rendered only while `value` was set — unmounted with it.
 * On a production build the re-render lands within a few hundred milliseconds, so the secret was
 * on screen for less time than it takes to read it; on `next dev` the re-render was slow enough
 * that the browser test read it first and the defect looked like a pass. Caught by the E2E plan
 * run against a production build, 2026-09-25.
 *
 * So the value is copied into client state the moment it arrives and rendered from there. The
 * refresh may take the prop away; the state keeps the secret on screen until the consultant
 * navigates. Stays mounted regardless of `value`, for the same reason.
 */
export function RevealOnce({
  title,
  hint,
  value,
  consume,
}: {
  title: string;
  hint: string;
  value: string | null;
  consume: () => Promise<void>;
}) {
  // Adjusted during render rather than in an effect (the React-endorsed shape for "state derived
  // from a prop that may go away"): a new non-null value is captured on the render it arrives in,
  // and a later null leaves it alone.
  const [shown, setShown] = useState<string | null>(value);
  if (value && value !== shown) setShown(value);

  useEffect(() => {
    if (value) void consume();
  }, [value, consume]);

  if (!shown) return null;
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">{title}</p>
      <p className="mt-1 break-all font-mono text-xs">{shown}</p>
      <p className="mt-1 text-xs text-amber-700">{hint}</p>
    </div>
  );
}
