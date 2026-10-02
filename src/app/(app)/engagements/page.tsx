import Link from "next/link";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { createEngagement } from "@/lib/actions/engagements";
import { runOrRedirect } from "@/lib/actions/errorRedirect";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Meter,
  PageHeader,
  SeverityBadge,
  buttonClass,
  cn,
  inputClass,
} from "@/components/ui";

const DEAL_STAGE_LABEL: Record<string, string> = {
  PRE_LOI: "Pre-LOI",
  POST_LOI: "Post-LOI",
  CLOSING: "Closing",
  CLOSED: "Closed",
  DEAD: "Dead",
};

/**
 * CLOSED and DEAD are terminal: the deal is no longer live work. They stay fully legible — a closed
 * engagement is still reference material during a later deal — but drop out of the scan, so a list
 * mixing finished and in-flight deals still answers "what am I working on" at a glance.
 */
const TERMINAL_STAGES = new Set(["CLOSED", "DEAD"]);

/**
 * Same three-way split as the audit page's `coverageStatus`: an all-NOT_APPLICABLE audit (total 0,
 * because computeSeverityRollup drops those from the denominator) is RESOLVED work, not pending
 * work, so it must not read as "not yet rated". Duplicated rather than shared because the audit
 * page's copy is page-local; if a third surface needs it, it belongs in @/lib/reports/rollup.
 */
function coverageStatus(rated: number, total: number): "not-applicable" | "not-yet-rated" | "rated" {
  if (total === 0) return "not-applicable";
  if (rated === 0) return "not-yet-rated";
  return "rated";
}

function DealStageChip({ stage }: { stage: string }) {
  const terminal = TERMINAL_STAGES.has(stage);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        terminal ? "border-ink-200 bg-ink-50 text-ink-500" : "border-accent-200 bg-accent-50 text-accent-700",
      )}
    >
      {/* Active stages read as a filled marker, terminal ones as a hollow one, so the live/finished
          split survives greyscale and colour vision deficiency rather than resting on hue. */}
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          terminal ? "border border-ink-400" : "bg-accent-500",
        )}
      />
      {DEAL_STAGE_LABEL[stage]}
    </span>
  );
}

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { orgId, userId } = await requireOrgSession();

  async function createEngagementAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => createEngagement(formData), "/engagements");
  }

  // Findings come down with the audits rather than being counted per row: Prisma resolves a nested
  // select in a fixed number of batched queries (engagements, then their audits, then those audits'
  // findings and template items keyed by parent id), so this stays constant-cost as the list grows
  // instead of one count per audit. Only the three fields computeSeverityRollup reads are selected —
  // notes and structured data never reach this page.
  const engagements = await withOrgScope(orgId, (tx) =>
    tx.engagement.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        audits: {
          select: {
            id: true,
            findings: {
              select: { severity: true, status: true, templateItem: { select: { tier: true } } },
            },
          },
        },
      },
    }),
  );
  // The viewer's own role: the first two onboarding steps are firm setup only an owner can do
  // (spec.md §3), and a member should be told they are waiting on someone rather than pointed at a
  // control they do not have.
  const onboarding = await withOrgScope(orgId, async (tx) => {
    const viewer = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    return getOnboardingStatus(tx, orgId, viewer?.role ?? "MEMBER");
  });

  return (
    <div>
      <PageHeader
        title="Engagements"
        description="One Engagement per acquisition deal being diligenced."
      />

      {error && (
        <Callout tone="error" className="mb-6">
          {error}
        </Callout>
      )}

      {!onboarding.complete && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-ink-100 bg-ink-50 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold text-ink-900">Get your first report out the door</h2>
              <span className="text-xs font-medium text-ink-500">
                {onboarding.completedCount}/{onboarding.totalCount} done
              </span>
            </div>
            <Meter
              className="mt-2.5"
              value={onboarding.completedCount}
              total={onboarding.totalCount}
              tone="positive"
            />
          </div>
          {/* The panel spans the page, the prose does not: these step details are sentences, and at
              the full width of a 6xl container they stop being readable. */}
          <CardBody className="max-w-2xl">
            <ol className="space-y-3">
              {(() => {
                // The highlighted call-to-action is the first unfinished step THIS VIEWER can act on.
                // Without the second condition a member's next action was "Set your firm branding" —
                // owner-only — so the checklist nudged them toward a control they do not have. The
                // step still shows, because an unacknowledged disclaimer blocks report generation for
                // the whole firm and a member needs to know why; it just is not presented as theirs.
                const firstTodo = onboarding.steps.findIndex((s) => !s.done && !s.waitingOnOwner);
                return onboarding.steps.map((step, i) => {
                  const isNext = i === firstTodo;
                  return (
                    <li
                      key={step.key}
                      className={cn(
                        "flex items-start gap-2.5 text-sm",
                        step.done ? "text-ink-400" : isNext ? "text-ink-900" : "text-ink-500",
                      )}
                    >
                      {/* Marker, not an ordinal. This rendered `i + 1` for every incomplete step,
                          so finishing out of order — which the product positively invites, since
                          creating an engagement needs no firm setup — produced the sequence
                          "1, 2, ✓, ✓, 5, 6, 7". A number that skips is a number that is lying about
                          position; the state (done / yours next / not yet) is the only thing this
                          marker ever needed to carry. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                          step.done
                            ? "bg-sev-green-bg text-sev-green"
                            : isNext
                              ? "bg-accent-600 text-white"
                              : "bg-ink-100 text-ink-400",
                        )}
                      >
                        {step.done ? "✓" : isNext ? "→" : "•"}
                      </span>
                      <span className="min-w-0">
                        <span className={cn("block", isNext && "font-medium")}>{step.title}</span>
                        {/* Shown for every step that is still outstanding, not only the call-to-
                            action. These sentences carry the preconditions — that Tier A needs a
                            primary domain, that report generation is blocked firm-wide until an
                            owner reviews the disclaimer — and hiding them until a step became "next"
                            meant the consultant read the explanation only after they were already
                            stuck on it. Done steps drop their detail: it is instruction, and the
                            instruction is spent. */}
                        {!step.done && (
                          <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                            {step.detail}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                });
              })()}
            </ol>
            {/* Only offered to someone who can actually finish it: firm branding and the disclaimer
                are owner-only (spec.md §3), so sending a member to Settings would land them on
                controls that reject them. Their checklist copy names the owner instead. */}
            {onboarding.steps.some((s) => s.ownerOnly && !s.done && !s.waitingOnOwner) && (
              <Link href="/settings" className={buttonClass("primary", "sm", "mt-4")}>
                Finish firm setup on Settings →
              </Link>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="New engagement" />
        <CardBody>
          <form
            action={createEngagementAction}
            className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <Field label="Business name" htmlFor="businessName">
              <input
                id="businessName"
                name="businessName"
                required
                className={inputClass()}
                placeholder="Example Restaurant LLC"
              />
            </Field>
            <Field label="Primary domain (for Tier A checks)" htmlFor="primaryDomain">
              <input
                id="primaryDomain"
                name="primaryDomain"
                className={inputClass()}
                placeholder="example-restaurant.com"
              />
            </Field>
            <Button type="submit">Create</Button>
          </form>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <ul className="divide-y divide-ink-100">
          {engagements.length === 0 && (
            <li>
              <EmptyState title="No engagements yet." />
            </li>
          )}
          {engagements.map((e) => {
            // Every audit on the deal, rolled up as one: the denominator then moves with the audit
            // count already on the row, so "3 audits · 20/69 rated" cannot be misread as the
            // progress of a single one. Which audit to resume is the engagement page's answer —
            // this list only has to say whether the deal still has open work. Fed through
            // computeSeverityRollup rather than counted here so the "a tier is its worst item"
            // rule and the NOT_APPLICABLE exclusion stay in one place (spec.md §6).
            const rollup = computeSeverityRollup(e.audits.flatMap((a) => a.findings));
            const coverage = rollup.overallCoverage;
            const status = coverageStatus(coverage.rated, coverage.total);
            return (
              <li key={e.id}>
                {/* The whole row is the target: mid-deal, this list is navigated at speed and a
                    name-sized hit area is the slowest part of it. */}
                <Link
                  href={`/engagements/${e.id}`}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:-outline-offset-2"
                  title={e.businessName}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate font-medium text-ink-900 group-hover:text-accent-700 group-focus-visible:text-accent-700">
                        {e.businessName}
                      </span>
                      <DealStageChip stage={e.dealStage} />
                    </div>
                    <div
                      className={cn(
                        "mt-1 truncate text-xs",
                        e.primaryDomain ? "font-mono text-ink-500" : "text-ink-400",
                      )}
                    >
                      {e.primaryDomain ?? "no domain set"}
                    </div>
                    {/* Inside the flexible column, never as its own fixed track: the row has to
                        survive 400px, where a rating chip plus a count plus a bar is wider than
                        the space left beside the name. */}
                    {e.audits.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {status === "rated" ? (
                          <SeverityBadge severity={rollup.overall} label={rollup.overall} size="sm" />
                        ) : (
                          <SeverityBadge
                            severity={null}
                            label={status === "not-applicable" ? "Not applicable" : "Not yet rated"}
                            size="sm"
                          />
                        )}
                        <span className="text-xs text-ink-500">
                          {coverage.rated}/{coverage.total} rated
                        </span>
                        <Meter
                          value={coverage.rated}
                          total={coverage.total}
                          className="w-full max-w-[10rem]"
                        />
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-ink-500">
                    {e.audits.length} audit{e.audits.length === 1 ? "" : "s"}
                  </span>
                  {/* Decorative, so no contrast minimum applies — but it is the ONLY standing cue
                      that the whole row is a link, and at ink-300 it measured 1.61:1 against the
                      card, i.e. invisible until hover. One step darker at rest, two on
                      hover/focus. */}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-ink-400 transition-colors group-hover:text-ink-700 group-focus-visible:text-ink-700"
                  >
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
