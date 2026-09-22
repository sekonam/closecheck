import Link from "next/link";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { createEngagement } from "@/lib/actions/engagements";
import { runOrRedirect } from "@/lib/actions/errorRedirect";
import { getOnboardingStatus } from "@/lib/onboarding/status";

const DEAL_STAGE_LABEL: Record<string, string> = {
  PRE_LOI: "Pre-LOI",
  POST_LOI: "Post-LOI",
  CLOSING: "Closing",
  CLOSED: "Closed",
  DEAD: "Dead",
};

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

  const engagements = await withOrgScope(orgId, (tx) =>
    tx.engagement.findMany({
      orderBy: { createdAt: "desc" },
      include: { audits: { select: { id: true } } },
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
      <h1 className="text-lg font-semibold text-slate-900">Engagements</h1>
      <p className="mt-1 text-sm text-slate-500">
        One Engagement per acquisition deal being diligenced (docs/spec.md §3).
      </p>

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!onboarding.complete && (
        <div className="mt-6 rounded-lg border border-slate-900/10 bg-slate-900 p-4 text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Get your first report out the door</h2>
            <span className="text-xs text-slate-300">
              {onboarding.completedCount}/{onboarding.totalCount} done
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${(onboarding.completedCount / onboarding.totalCount) * 100}%` }}
            />
          </div>
          <ol className="mt-3 space-y-1.5">
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
                    className={`flex items-start gap-2 text-sm ${
                      step.done ? "text-slate-400" : isNext ? "text-white" : "text-slate-400/70"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        step.done ? "bg-emerald-400 text-slate-900" : isNext ? "bg-white text-slate-900" : "bg-white/15"
                      }`}
                    >
                      {step.done ? "✓" : i + 1}
                    </span>
                    <span>
                      <span className={isNext ? "font-medium" : ""}>{step.title}</span>
                      {/* Also shown for a step that is someone else's to do: detail used to render
                          only for the call-to-action, so making owner-only steps non-actionable for
                          a member hid the very sentence explaining why. The member would have seen
                          "Set your firm branding" with no indication it was not theirs. */}
                      {(isNext || step.waitingOnOwner) && (
                        <span className="block text-xs text-slate-300">{step.detail}</span>
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
            <Link
              href="/settings"
              className="mt-3 inline-block rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-100"
            >
              Finish firm setup on Settings →
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">New engagement</h2>
        <form action={createEngagementAction} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="businessName">
              Business name
            </label>
            <input
              id="businessName"
              name="businessName"
              required
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Example Restaurant LLC"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="primaryDomain">
              Primary domain (for Tier A checks)
            </label>
            <input
              id="primaryDomain"
              name="primaryDomain"
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="example-restaurant.com"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Create
          </button>
        </form>
      </div>

      <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {engagements.length === 0 && (
          <li className="p-4 text-sm text-slate-500">No engagements yet.</li>
        )}
        {engagements.map((e) => (
          <li key={e.id} className="flex items-center justify-between p-4">
            <div className="min-w-0">
              <Link
                href={`/engagements/${e.id}`}
                className="block truncate font-medium text-slate-900 hover:underline"
                title={e.businessName}
              >
                {e.businessName}
              </Link>
              <div className="truncate text-xs text-slate-500">
                {DEAL_STAGE_LABEL[e.dealStage]} · {e.primaryDomain ?? "no domain set"} ·{" "}
                {e.audits.length} audit{e.audits.length === 1 ? "" : "s"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
