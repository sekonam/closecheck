import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { signUp } from "@/lib/actions/auth";
import { Button, Callout, Card, CardBody, Field, inputClass } from "@/components/ui";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function signup(formData: FormData) {
    "use server";
    try {
      await signUp(formData);
    } catch (err) {
      // signUp() itself calls signIn() with a redirectTo on success, which throws Next's internal
      // redirect signal (implemented as an Error-like object with a NEXT_REDIRECT digest) rather than
      // returning — that's not a failure to report, it's the successful path continuing. Without
      // rethrowing it first, the `err instanceof Error` check below would catch it too and misroute a
      // successful signup to "/signup?error=..." instead of completing the redirect to /engagements.
      unstable_rethrow(err);
      if (err instanceof Error) {
        redirect(`/signup?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="flex items-center gap-2.5">
            {/* Same inline mark as /login — no external asset, no network at build. */}
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
          <p className="mt-3 text-sm text-ink-500">Create your consultant account.</p>
        </div>

        <Card className="shadow-sm">
          <CardBody className="px-5 py-5 sm:px-6 sm:py-6">
            <form action={signup} className="space-y-4">
              <Field label="Firm name" htmlFor="orgName">
                <input
                  id="orgName"
                  name="orgName"
                  required
                  autoComplete="organization"
                  className={inputClass()}
                />
              </Field>
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
                  minLength={8}
                  autoComplete="new-password"
                  className={inputClass()}
                />
              </Field>
              <Field label="Confirm password" htmlFor="confirmPassword">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className={inputClass()}
                />
              </Field>
              {/* The server action's own message, rendered verbatim — it is the only thing that
                  tells a consultant which field the server rejected. */}
              {error && <Callout tone="error">{error}</Callout>}
              <Button type="submit" className="w-full">
                Create account
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="mt-6 text-sm text-ink-500">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
