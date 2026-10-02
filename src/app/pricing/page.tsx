import Link from "next/link";
import { buttonClass, Callout, Card, cn } from "@/components/ui";

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
 *
 * Visually the three plans are deliberately a comparison, not a sales funnel: same card, same
 * order of information, one included-list each, and no "most popular" nudge. The buyer of this
 * product is a professional pricing a tool against billable hours.
 */
export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-ink-900 sm:text-3xl">Pricing</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          Simple annual pricing with bundled audit credits — no per-seat metering to think about.
        </p>
      </div>
      <Callout tone="warning" className="mt-6 max-w-2xl">
        These numbers are placeholders pending real-world validation, not committed
        pricing — they may change before General Availability.
      </Callout>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
        <PlanCard
          name="Solo"
          price="$588"
          priceSuffix="/yr"
          meta="1 seat"
          features={[
            "6 full audits included",
            "Additional audits at $69 each",
            "Unlimited Tier A automated checks",
            "Whitelabel branding & report appendix",
          ]}
          cta={{ href: "/signup", label: "Get started", variant: "primary" }}
        />

        <PlanCard
          name="Team"
          price="$588"
          priceSuffix="/yr base"
          meta="+ $20–30/seat/mo, up to ~5 seats"
          features={[
            "Everything in Solo",
            "Included audits scale with seats",
            "Shared engagements across the firm",
          ]}
          cta={{ href: "/signup", label: "Get started", variant: "primary" }}
          emphasis
        />

        <PlanCard
          name="Firm"
          price="Custom"
          meta="Custom seats & volume"
          features={["Everything in Team", "White-label options", "Priority support"]}
          cta={{ href: "/signup", label: "Contact us", variant: "secondary" }}
        />
      </div>

      <p className="mt-10 border-t border-ink-200 pt-6 text-sm text-ink-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

/**
 * One plan. The copy is passed in rather than derived so every string on this page stays exactly
 * what the page itself declares — pricing wording is a commitment, not a template.
 */
function PlanCard({
  name,
  price,
  priceSuffix,
  meta,
  features,
  cta,
  emphasis = false,
}: {
  name: string;
  price: string;
  priceSuffix?: string;
  meta: string;
  features: string[];
  cta: { href: string; label: string; variant: "primary" | "secondary" };
  emphasis?: boolean;
}) {
  return (
    /* The emphasised plan gets a ring rather than a different border or shadow: Card already sets
       both of those, and two utilities competing for one property resolve by stylesheet order, not
       by the order they are written in here. */
    <Card className={cn("flex h-full flex-col p-5", emphasis && "ring-1 ring-accent-300")}>
      <h2
        className={cn(
          "text-xs font-semibold tracking-wide uppercase",
          emphasis ? "text-accent-700" : "text-ink-500",
        )}
      >
        {name}
      </h2>
      <p className="mt-3 text-3xl font-semibold text-ink-900">
        {price}
        {priceSuffix ? <span className="text-sm font-normal text-ink-500">{priceSuffix}</span> : null}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{meta}</p>

      <ul className="mt-5 space-y-2.5 border-t border-ink-100 pt-5 text-sm text-ink-600">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <IncludedMark emphasis={emphasis} />
            <span className="min-w-0 leading-relaxed">{feature}</span>
          </li>
        ))}
      </ul>

      {/* Pushed to the card's floor on the three-up layout so the buttons line up across plans
          however many included-lines each one has. */}
      <div className="mt-6 sm:mt-auto sm:pt-6">
        <Link href={cta.href} className={buttonClass(cta.variant, "md", "w-full")}>
          {cta.label}
        </Link>
      </div>
    </Card>
  );
}

/** Drawn, not typed: a glyph would add text to a page whose copy is asserted verbatim. */
function IncludedMark({ emphasis }: { emphasis: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("mt-0.5 h-4 w-4 shrink-0", emphasis ? "text-accent-600" : "text-ink-400")}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
