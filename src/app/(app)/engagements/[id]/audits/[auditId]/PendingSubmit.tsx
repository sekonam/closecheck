"use client";

/**
 * A submit button that says it is working, and refuses to be pressed twice while it is.
 *
 * Report generation takes ~5.7s. Before this, the whole UI stayed inert for all of it: the button
 * stayed enabled, nothing spun, nothing announced. Two clicks 150ms apart produced TWO reports —
 * and there is no delete-report action anywhere in the product, so the consultant is left with two
 * near-identical timestamped reports and no way to tell which one went to the buyer. The duplicate
 * is the real defect; the missing feedback is what causes it.
 *
 * `useFormStatus` reads the state of the form this renders inside, so the component has to be a
 * CHILD of that form — it is not a wrapper around one.
 *
 * Deliberately narrow: it is not applied to the finding Save buttons. Those return in well under a
 * second, a disabled window there would be felt on every one of ~24 saves, and a double-save is
 * idempotent rather than destructive — the opposite of this case on every count.
 */

import { useFormStatus } from "react-dom";

export function PendingSubmit({
  children,
  pendingLabel,
  className,
  pendingClassName,
  disabled,
}: {
  /** The button's label. Unchanged while pending — the status line carries that, not the label. */
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  pendingClassName?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        // The disable IS the duplicate-submit guard: a disabled submit cannot fire the form again,
        // so the second click of a double-click lands on nothing.
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        className={className}
      >
        {children}
      </button>
      {/* A live region rather than a label swap: screen-reader users get told, and the button's own
          text — which the browser suites and the consultant both rely on — never moves. */}
      {pending && (
        <span role="status" className={pendingClassName}>
          {pendingLabel}
        </span>
      )}
    </>
  );
}
