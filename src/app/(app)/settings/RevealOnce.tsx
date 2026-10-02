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
    // The only moment this secret exists on screen, so it is drawn as a deliberate panel rather than
    // a note: amber frame, the value alone in a monospace well. The title stays a DIRECT child <p>
    // and the value the panel's only `.font-mono` — both are how the browser suite finds them.
    <div className="overflow-hidden rounded-md border border-sev-amber-border bg-sev-amber-bg shadow-xs">
      <p className="border-b border-sev-amber-border/70 px-3.5 py-2 text-sm font-semibold text-sev-amber">
        {title}
      </p>
      <div className="px-3.5 py-3">
        <p className="rounded-md border border-sev-amber-border bg-white px-3 py-2 font-mono text-xs break-all text-ink-900 select-all">
          {shown}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-sev-amber">{hint}</p>
      </div>
    </div>
  );
}
