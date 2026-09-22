import type { ScopedTx } from "@/lib/db/scoped";

/**
 * First-audit onboarding (docs/roadmap.md Phase 2.5: "a guided, founder-assisted first audit").
 * Every step is derived from real org state, never a stored "dismissed onboarding" flag — so the
 * guide reflects what the consultant has actually done and disappears on its own once the first
 * full journey is complete. It also mirrors spec.md §11's activation funnel (engagement → audit →
 * Tier A → report → shared), which is exactly the sequence a first-time user needs walked through.
 */
export type OnboardingStep = {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  /** The first not-done step is the call-to-action; earlier ones are checkmarks, later ones muted. */
};

export type OnboardingStatus = {
  complete: boolean;
  completedCount: number;
  totalCount: number;
  steps: OnboardingStep[];
  disclaimerAcknowledged: boolean;
};

export async function getOnboardingStatus(tx: ScopedTx, orgId: string): Promise<OnboardingStatus> {
  const [org, engagementCount, auditCount, tierAFinding, reportCount, portalLinkCount] = await Promise.all([
    tx.consultantOrg.findUniqueOrThrow({
      where: { id: orgId },
      select: { brandLogoUrl: true, brandColorHex: true, disclaimerAcknowledgedAt: true },
    }),
    tx.engagement.count(),
    tx.audit.count(),
    // Any automated Tier A finding that's moved past NOT_STARTED means the checks were run at least once.
    tx.finding.findFirst({
      where: { status: { not: "NOT_STARTED" }, templateItem: { method: "AUTOMATED" } },
      select: { id: true },
    }),
    tx.report.count(),
    tx.clientPortalLink.count(),
  ]);

  const brandingSet = !!org.brandLogoUrl || !!org.brandColorHex;

  const steps: OnboardingStep[] = [
    {
      key: "branding",
      title: "Set your firm branding",
      detail: "Add your logo and brand color on Settings — every report goes out under your name, not CloseCheck's.",
      done: brandingSet,
    },
    {
      key: "disclaimer",
      title: "Review the report disclaimer",
      detail: "A one-time review on Settings unlocks report generation (spec.md §6).",
      done: !!org.disclaimerAcknowledgedAt,
    },
    {
      key: "engagement",
      title: "Create your first engagement",
      detail: "One engagement per deal. Add the target business and its primary domain.",
      done: engagementCount > 0,
    },
    {
      key: "audit",
      title: "Start an audit",
      detail: "Pick a business-type template and start working the tiered checklist.",
      done: auditCount > 0,
    },
    {
      key: "tier-a",
      title: "Run the Tier A automated checks",
      detail: "Domain, DNS, SSL, email auth, and HTTPS checks run from public info — no seller cooperation needed.",
      done: !!tierAFinding,
    },
    {
      key: "report",
      title: "Generate a report",
      detail: "Turn the findings into a whitelabeled PDF you can hand to the buyer.",
      done: reportCount > 0,
    },
    {
      key: "share",
      title: "Share it with a client portal link",
      detail: "Optional: a revocable, no-account link the buyer can open directly (spec.md §7).",
      done: portalLinkCount > 0,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  return {
    complete: completedCount === steps.length,
    completedCount,
    totalCount: steps.length,
    steps,
    disclaimerAcknowledged: !!org.disclaimerAcknowledgedAt,
  };
}
