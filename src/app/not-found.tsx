import Link from "next/link";
import { buttonClass } from "@/components/ui";

/**
 * Without this, Next.js's default not-found UI renders with its own dark-theme styling regardless
 * of the app's own theme — found via UI testing: a genuinely broken-looking black screen under our
 * light-themed header. Root-level so it applies under every route, including (app) and its nested
 * segments.
 *
 * Deliberately carries no CloseCheck wordmark: this boundary also catches a bad or revoked
 * /portal/<token>, i.e. a buyer who should never be shown this product's name (spec.md §2
 * principle 4). Calm neutral chrome reads correctly to both audiences.
 *
 * min-h as well as flex-1 because this renders both as a bare body child (public routes) and
 * inside (app)'s plain-block <main>, where flex-1 does nothing.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-400 shadow-xs"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
          </svg>
        </span>
        <h1 className="mt-5 text-xl font-semibold text-ink-900">Not found</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
          This page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
        <Link href="/engagements" className={buttonClass("secondary", "md", "mt-6")}>
          Back to Engagements
        </Link>
      </div>
    </div>
  );
}
