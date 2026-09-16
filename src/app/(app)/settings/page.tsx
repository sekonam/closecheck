import Link from "next/link";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { updateOrgBranding, uploadOrgLogo, removeOrgLogo } from "@/lib/actions/org";

export default async function SettingsPage() {
  const { orgId } = await requireOrgSession();

  const org = await withOrgScope(orgId, (tx) => tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } }));

  return (
    <div>
      <Link href="/engagements" className="text-sm text-slate-500 hover:underline">
        ← Engagements
      </Link>
      <h1 className="mt-2 text-lg font-semibold text-slate-900">Firm branding</h1>
      <p className="text-sm text-slate-500">
        Your logo, name, and brand color appear on the cover and footer of every generated report
        (docs/spec.md §6) — never CloseCheck&apos;s.
      </p>

      <div
        key={`${org.name}-${org.brandColorHex}`}
        className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-medium text-slate-900">Firm name and color</h2>
        <form action={updateOrgBranding} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="name">
              Firm name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={org.name}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="brandColorHex">
              Brand color
            </label>
            <input
              id="brandColorHex"
              name="brandColorHex"
              defaultValue={org.brandColorHex ?? ""}
              placeholder="#0f172a"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-slate-400">Blank = default (#0f172a).</p>
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
        <h2 className="text-sm font-medium text-slate-900">Logo</h2>
        <div className="mt-3 flex items-center gap-4">
          {org.brandLogoUrl ? (
            // Cache-busted with updatedAt so the preview reflects a just-replaced logo immediately —
            // /api/branding/logo itself is always served no-store, but the <img> tag's src is
            // otherwise identical across uploads and the browser's own image cache can still short-
            // circuit the request without a query-string change.
            // eslint-disable-next-line @next/next/no-img-element -- external-route-served, not a static/optimizable asset
            <img
              src={`/api/branding/logo?t=${org.updatedAt.getTime()}`}
              alt="Firm logo"
              className="h-16 w-auto rounded border border-slate-200 bg-white p-1"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
              No logo
            </div>
          )}
          <form action={uploadOrgLogo} className="flex items-center gap-2">
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Upload
            </button>
          </form>
          {org.brandLogoUrl && (
            <form action={removeOrgLogo}>
              <button type="submit" className="text-sm text-slate-500 underline hover:text-slate-700">
                Remove
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
