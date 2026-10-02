import type { UserRole } from "@prisma/client";
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
  /**
   * Firm setup, which only an account owner can complete (spec.md §3's firm-scoped set: branding,
   * and accepting the disclaimer on the firm's behalf).
   *
   * Shown to a member rather than hidden, deliberately. These two gate work a member CAN do — an
   * unacknowledged disclaimer blocks report generation for everyone — so a member who cannot
   * generate a report needs to know why, and "waiting on the account owner" is a better answer than
   * an item that silently is not there. Hiding it would turn a firm-level prerequisite into an
   * unexplained failure later, which is the same shape as telling someone to use a control they do
   * not have.
   */
  ownerOnly: boolean;
  /** True when this step is owner-only and the viewer is not an owner: it is someone else's to do. */
  waitingOnOwner: boolean;
};

export type OnboardingStatus = {
  complete: boolean;
  completedCount: number;
  totalCount: number;
  steps: OnboardingStep[];
  disclaimerAcknowledged: boolean;
};

export async function getOnboardingStatus(
  tx: ScopedTx,
  orgId: string,
  viewerRole: UserRole,
): Promise<OnboardingStatus> {
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
  const isOwner = viewerRole === "OWNER";

  const steps: OnboardingStep[] = [
    {
      key: "branding",
      title: "Set your firm branding",
      // The copy says what `brandingSet` actually checks. It used to promise "logo and brand color"
      // while the condition below is an OR, so setting a colour alone ticked the step off — a
      // checklist whose whole job is stopping an unbranded first report, clearing itself on half
      // the work. A logo is genuinely optional (plenty of firms have only a wordmark); the colour
      // is what always applies, so the sentence now leads with it.
      detail: isOwner
        ? "Add your brand color on Settings, and a logo if you have one — every report goes out under your name, not CloseCheck's."
        : "Your account owner sets the firm's color and logo. Reports go out under the firm's name once they have.",
      done: brandingSet,
      ownerOnly: true,
      waitingOnOwner: !isOwner && !brandingSet,
    },
    {
      key: "disclaimer",
      title: "Review the report disclaimer",
      detail: isOwner
        // Customer-facing copy: no internal document references. These sentences are the first
        // thing a paying consultant reads, and a citation to a spec they cannot open reads as
        // unfinished software (spec.md §6 is the rule behind it, recorded here instead).
        ? "A one-time review on Settings unlocks report generation."
        : "Report generation is blocked for the whole firm until your account owner reviews the disclaimer once.",
      done: !!org.disclaimerAcknowledgedAt,
      ownerOnly: true,
      waitingOnOwner: !isOwner && !org.disclaimerAcknowledgedAt,
    },
    {
      key: "engagement",
      title: "Create your first engagement",
      detail: "One engagement per deal. Add the target business and its primary domain.",
      done: engagementCount > 0,
      ownerOnly: false,
      waitingOnOwner: false,
    },
    {
      key: "audit",
      title: "Start an audit",
      detail: "Pick a business-type template and start working the tiered checklist.",
      done: auditCount > 0,
      ownerOnly: false,
      waitingOnOwner: false,
    },
    {
      key: "tier-a",
      title: "Run the Tier A automated checks",
      // Names its precondition. The audit page states it well and adjacently ("Set a primary domain
      // on the engagement to enable Tier A automation", with the button genuinely disabled), but a
      // consultant who created an engagement without a domain reads THIS list to find out why they
      // are stuck, and it was the one place that did not mention the requirement.
      detail:
        "Domain, DNS, SSL, email auth, and HTTPS checks run from public info — no seller cooperation needed. Needs a primary domain on the engagement.",
      done: !!tierAFinding,
      ownerOnly: false,
      waitingOnOwner: false,
    },
    {
      key: "report",
      title: "Generate a report",
      detail: "Turn the findings into a whitelabeled PDF you can hand to the buyer.",
      done: reportCount > 0,
      ownerOnly: false,
      waitingOnOwner: false,
    },
    {
      key: "share",
      title: "Share it with a client portal link",
      // No internal document reference in customer-facing copy — see the note on the disclaimer
      // step above. The rule behind this one is spec.md §7.
      detail: "Optional: a revocable, no-account link the buyer can open directly.",
      done: portalLinkCount > 0,
      ownerOnly: false,
      waitingOnOwner: false,
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
