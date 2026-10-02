import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth/config";
import { Button, Callout, Card, CardBody, Field, inputClass } from "@/components/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/engagements",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw err;
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="flex items-center gap-2.5">
            {/* Mark drawn inline rather than loaded: this page must render with no network at
                build time and no external asset at request time. */}
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-900 shadow-xs"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="#ffffff"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <h1 className="text-lg font-semibold text-ink-900">CloseCheck</h1>
          </div>
          <p className="mt-3 text-sm text-ink-500">Sign in to your consultant account.</p>
        </div>

        <Card className="shadow-sm">
          <CardBody className="px-5 py-5 sm:px-6 sm:py-6">
            <form action={login} className="space-y-4">
              <Field label="Email" htmlFor="email">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className={inputClass()}
                />
              </Field>
              <Field label="Password" htmlFor="password">
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className={inputClass()}
                />
              </Field>
              {error && (
                <Callout tone="error">
                  Invalid email or password.
                </Callout>
              )}
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="mt-6 text-sm text-ink-500">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
          >
            Sign up
          </Link>{" "}
          ·{" "}
          <Link
            href="/pricing"
            className="font-medium text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
          >
            Pricing
          </Link>
        </p>

        {/* A local-dev affordance, not product copy — kept verbatim, demoted to a footnote so it
            never reads as something a real signing-in consultant is meant to act on. */}
        <p className="mt-6 border-t border-ink-200 pt-4 font-mono text-[11px] leading-relaxed text-ink-400">
          Local dev seed: dev@closecheck.local / devpassword123 (see prisma/seed.ts)
        </p>
      </div>
    </div>
  );
}
