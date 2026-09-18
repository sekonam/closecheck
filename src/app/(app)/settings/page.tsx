import Link from "next/link";
import { cookies } from "next/headers";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { updateOrgBranding, uploadOrgLogo, removeOrgLogo, acknowledgeDisclaimer } from "@/lib/actions/org";
import { inviteMember, removeMember } from "@/lib/actions/team";
import { REPORT_DISCLAIMER_TEXT } from "@/lib/reports/disclaimer";
import { runOrRedirect } from "@/lib/actions/errorRedirect";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { orgId, userId } = await requireOrgSession();

  async function updateOrgBrandingAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => updateOrgBranding(formData), "/settings");
  }
  async function uploadOrgLogoAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => uploadOrgLogo(formData), "/settings");
  }
  async function removeOrgLogoAction() {
    "use server";
    await runOrRedirect(() => removeOrgLogo(), "/settings");
  }
  async function acknowledgeDisclaimerAction() {
    "use server";
    await runOrRedirect(() => acknowledgeDisclaimer(), "/settings");
  }
  async function inviteMemberAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => inviteMember(formData), "/settings");
  }
  async function removeMemberAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => removeMember(formData), "/settings");
  }

  const org = await withOrgScope(orgId, (tx) => tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId } }));
  const members = await withOrgScope(orgId, (tx) =>
    tx.user.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
  );
  const isOwner = members.find((m) => m.id === userId)?.role === "OWNER";

  // One-time display of a just-generated invite password (src/lib/actions/team.ts's inviteMember) —
  // the cookie has a 60s maxAge and isn't explicitly deleted here (a Server Component can't delete
  // cookies during render), it just naturally stops appearing once it expires.
  const cookieStore = await cookies();
  const tempPasswordCookie = cookieStore.get("closecheck_invite_temp_password")?.value;
  const [invitedEmail, invitedTempPassword] = tempPasswordCookie?.split(":") ?? [];

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

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div
        key={`${org.name}-${org.brandColorHex}`}
        className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-medium text-slate-900">Firm name and color</h2>
        <form action={updateOrgBrandingAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <form action={uploadOrgLogoAction} className="flex items-center gap-2">
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Upload
            </button>
          </form>
          {org.brandLogoUrl && (
            <form action={removeOrgLogoAction}>
              <button type="submit" className="text-sm text-slate-500 underline hover:text-slate-700">
                Remove
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">Report disclaimer</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every generated report includes this language (docs/spec.md §6). Review it once — report
          generation is blocked until you do.
        </p>
        <blockquote className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {REPORT_DISCLAIMER_TEXT}
        </blockquote>
        {org.disclaimerAcknowledgedAt ? (
          <p className="mt-3 text-sm text-emerald-700">
            Reviewed on {org.disclaimerAcknowledgedAt.toISOString().slice(0, 10)}.
          </p>
        ) : (
          <form action={acknowledgeDisclaimerAction} className="mt-3">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              I&apos;ve reviewed this language — enable report generation
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">Team</h2>
        <p className="mt-1 text-xs text-slate-500">
          Everyone listed here shares this firm&apos;s engagements, templates, and branding
          (docs/roadmap.md Phase 2). Only the account owner can invite or remove teammates.
        </p>

        {invitedEmail && invitedTempPassword && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Temporary password for {invitedEmail}</p>
            <p className="mt-1 font-mono text-xs">{invitedTempPassword}</p>
            <p className="mt-1 text-xs text-amber-700">
              Shown once — relay it to them yourself. There is no invite-email sending yet (Phase 2
              placeholder); this password won&apos;t be shown again after you leave this page.
            </p>
          </div>
        )}

        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <div>
                <span className="font-medium text-slate-900">{m.name || m.email}</span>
                {m.name && <span className="ml-2 text-slate-500">{m.email}</span>}
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {m.role}
                </span>
              </div>
              {isOwner && (
                <form action={removeMemberAction}>
                  <input type="hidden" name="userId" value={m.id} />
                  <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-700">
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>

        {isOwner && (
          <form action={inviteMemberAction} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              name="email"
              type="email"
              placeholder="teammate@example.com"
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              name="name"
              placeholder="Name (optional)"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Invite
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
