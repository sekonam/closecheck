import Link from "next/link";

/**
 * Public pricing page (docs/roadmap.md Phase 2 — "self-serve signup and the pricing page, the first
 * point pricing becomes real rather than a discovery-call conversation"). Built ahead of
 * design-partner validation per explicit user direction, same caveat as the new templates and
 * self-serve signup this session added.
 *
 * Uses spec.md §9's "simpler fallback" model (annual + bundled audit credits) rather than the
 * metered hybrid (base subscription + per-audit overage) — no real billing infrastructure exists yet
 * (placeholder-only decision this session, no payment processor wired up), and the simpler fallback
 * is the one spec.md itself describes as not needing metered-billing infrastructure to offer.
 *
 * spec.md §9 is explicit that these numbers are "placeholders for Phase 0 validation, not
 * commitments" — that framing is carried onto the page itself, not dropped just because a real page
 * now exists to show them on.
 */
export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">Pricing</h1>
      <p className="mt-2 text-sm text-slate-600">
        Simple annual pricing with bundled audit credits — no per-seat metering to think about.
      </p>
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        These numbers are placeholders pending real-world validation (docs/spec.md §9), not committed
        pricing — they may change before General Availability.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-medium text-slate-900">Solo</h2>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            $588<span className="text-sm font-normal text-slate-500">/yr</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">1 seat</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li>6 full audits included</li>
            <li>Additional audits at $69 each</li>
            <li>Unlimited Tier A automated checks</li>
            <li>Whitelabel branding &amp; report appendix</li>
          </ul>
          <Link
            href="/signup"
            className="mt-6 block rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
          >
            Get started
          </Link>
        </div>

        <div className="rounded-lg border border-slate-300 bg-white p-5 ring-1 ring-slate-300">
          <h2 className="text-sm font-medium text-slate-900">Team</h2>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            $588<span className="text-sm font-normal text-slate-500">/yr base</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">+ $20–30/seat/mo, up to ~5 seats</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li>Everything in Solo</li>
            <li>Included audits scale with seats</li>
            <li>Shared engagements across the firm</li>
          </ul>
          <Link
            href="/signup"
            className="mt-6 block rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
          >
            Get started
          </Link>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-medium text-slate-900">Firm</h2>
          <p className="mt-2 text-2xl font-semibold text-slate-900">Custom</p>
          <p className="mt-1 text-xs text-slate-500">Custom seats &amp; volume</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li>Everything in Team</li>
            <li>White-label options</li>
            <li>Priority support</li>
          </ul>
          <Link
            href="/signup"
            className="mt-6 block rounded-md border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Contact us
          </Link>
        </div>
      </div>

      <p className="mt-8 text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-slate-700 underline hover:text-slate-900">
          Sign in
        </Link>
      </p>
    </div>
  );
}
