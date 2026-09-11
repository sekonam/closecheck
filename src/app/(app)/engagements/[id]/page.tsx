import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { prisma } from "@/lib/db/client";
import { createAudit } from "@/lib/actions/audits";
import { updateEngagement } from "@/lib/actions/engagements";

const DEAL_STAGES = ["PRE_LOI", "POST_LOI", "CLOSING", "CLOSED", "DEAD"] as const;

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireOrgSession();

  const engagement = await withOrgScope(orgId, (tx) =>
    tx.engagement.findUnique({
      where: { id },
      include: { audits: { include: { template: true }, orderBy: { createdAt: "desc" } } },
    }),
  );
  if (!engagement) notFound();

  // Shared, non-tenant content (spec.md §5) — read directly.
  const activeTemplates = await prisma.template.findMany({ where: { isActive: true } });

  return (
    <div>
      <Link href="/engagements" className="text-sm text-slate-500 hover:underline">
        ← Engagements
      </Link>
      <h1 className="mt-2 text-lg font-semibold text-slate-900">{engagement.businessName}</h1>
      <p className="text-sm text-slate-500">
        {engagement.primaryDomain ?? "No primary domain set"} · {engagement.dealStage}
      </p>

      <div
        key={`${engagement.businessName}-${engagement.primaryDomain}-${engagement.dealStage}-${engagement.documentPurgeAt?.toISOString()}`}
        className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-medium text-slate-900">Edit engagement</h2>
        <form action={updateEngagement} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="engagementId" value={engagement.id} />
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="businessName">
              Business name
            </label>
            <input
              id="businessName"
              name="businessName"
              defaultValue={engagement.businessName}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="primaryDomain">
              Primary domain (for Tier A checks)
            </label>
            <input
              id="primaryDomain"
              name="primaryDomain"
              defaultValue={engagement.primaryDomain ?? ""}
              placeholder="example-restaurant.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="dealStage">
              Deal stage
            </label>
            <select
              id="dealStage"
              name="dealStage"
              defaultValue={engagement.dealStage}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", "-")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="documentPurgeAt">
              Purge uploaded documents on/after (docs/spec.md §8)
            </label>
            <input
              id="documentPurgeAt"
              name="documentPurgeAt"
              type="date"
              defaultValue={engagement.documentPurgeAt?.toISOString().slice(0, 10) ?? ""}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-slate-400">
              Blank = no purge scheduled. Applied by `npm run db:purge-expired-documents`, not automatically.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Save
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">Start a new audit</h2>
        <form action={createAudit} className="mt-3 flex items-end gap-3">
          <input type="hidden" name="engagementId" value={engagement.id} />
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="templateSlug">
              Template
            </label>
            <select
              id="templateSlug"
              name="templateSlug"
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {activeTemplates.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} (v{t.version})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Start audit
          </button>
        </form>
      </div>

      <h2 className="mt-8 text-sm font-medium text-slate-900">Audits</h2>
      <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {engagement.audits.length === 0 && (
          <li className="p-4 text-sm text-slate-500">No audits started yet.</li>
        )}
        {engagement.audits.map((a) => (
          <li key={a.id} className="flex items-center justify-between p-4">
            <div>
              <Link
                href={`/engagements/${engagement.id}/audits/${a.id}`}
                className="font-medium text-slate-900 hover:underline"
              >
                {a.template.name} v{a.template.version}
              </Link>
              <div className="text-xs text-slate-500">{a.status}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
