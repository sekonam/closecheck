import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth/config";
import { buttonClass } from "@/components/ui";

/**
 * Product chrome for every signed-in surface.
 *
 * Deliberately a single bar with no active-state highlight: this is a Server Component, the current
 * path is not available to it, and adding "use client" to the shell would pull the whole app
 * chrome into the client bundle for a styling nicety.
 */
const NAV_ITEMS = [
  { href: "/engagements", label: "Engagements" },
  // "Branding" rather than "Settings": the destination's own heading is "Firm branding", and the
  // label is asserted as-is by the browser suites.
  { href: "/settings", label: "Branding" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.orgId) {
    redirect("/login");
  }

  const email = session.user.email ?? "";

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        {/* Wraps rather than hides at narrow widths: the chrome has to stay whole at 400px, and
            every page is swept for horizontal overflow at that viewport. */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/engagements" className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-900"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink-900">CloseCheck</span>
          </Link>

          <nav aria-label="Main" className="flex shrink-0 items-center gap-0.5">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-1.5 rounded-md border border-ink-200 bg-ink-50 py-1 pr-1 pl-1.5">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[10px] font-semibold text-ink-700"
            >
              {email.trim().slice(0, 1).toUpperCase()}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                className="max-w-[9rem] truncate text-xs font-medium text-ink-600 sm:max-w-[16rem]"
                title={email}
              >
                {email}
              </span>
              <button type="submit" className={buttonClass("ghost", "sm", "shrink-0")}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
