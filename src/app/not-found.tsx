import Link from "next/link";

/**
 * Without this, Next.js's default not-found UI renders with its own dark-theme styling regardless
 * of the app's own theme — found via UI testing: a genuinely broken-looking black screen under our
 * light-themed header. Root-level so it applies under every route, including (app) and its nested
 * segments.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Not found</h1>
      <p className="text-sm text-slate-500">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/engagements" className="mt-2 text-sm text-slate-700 underline hover:text-slate-900">
        Back to Engagements
      </Link>
    </div>
  );
}
