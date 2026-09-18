import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { signUp } from "@/lib/actions/auth";

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
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-900">CloseCheck</h1>
        <p className="mt-1 text-sm text-slate-500">Create your consultant account.</p>

        <form action={signup} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="orgName">
              Firm name
            </label>
            <input
              id="orgName"
              name="orgName"
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="confirmPassword">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Create account
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-700 underline hover:text-slate-900">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
