import Link from "next/link";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { createEngagement } from "@/lib/actions/engagements";

const DEAL_STAGE_LABEL: Record<string, string> = {
  PRE_LOI: "Pre-LOI",
  POST_LOI: "Post-LOI",
  CLOSING: "Closing",
  CLOSED: "Closed",
  DEAD: "Dead",
};

export default async function EngagementsPage() {
  const { orgId } = await requireOrgSession();

  const engagements = await withOrgScope(orgId, (tx) =>
    tx.engagement.findMany({
      orderBy: { createdAt: "desc" },
      include: { audits: { select: { id: true } } },
    }),
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Engagements</h1>
      <p className="mt-1 text-sm text-slate-500">
        One Engagement per acquisition deal being diligenced (docs/spec.md §3).
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">New engagement</h2>
        <form action={createEngagement} className="mt-3 flex flex-wrap items-end gap-3">
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
            <div>
              <Link href={`/engagements/${e.id}`} className="font-medium text-slate-900 hover:underline">
                {e.businessName}
              </Link>
              <div className="text-xs text-slate-500">
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
