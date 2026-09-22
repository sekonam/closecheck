import Link from "next/link";
import { cookies } from "next/headers";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { updateOrgBranding, uploadOrgLogo, removeOrgLogo, acknowledgeDisclaimer } from "@/lib/actions/org";
import { inviteMember, removeMember } from "@/lib/actions/team";
import { createApiKey, revokeApiKey } from "@/lib/actions/apiKeys";
import { addWebhookEndpoint, deleteWebhookEndpoint } from "@/lib/actions/webhooks";
import { startCheckout, openBillingPortal } from "@/lib/actions/billing";
import { isBillingConfigured, isEnforcementEnabled, PLAN_LABELS } from "@/lib/billing/config";
import { getCreditBalance } from "@/lib/billing/credits";
import { BillingPlan } from "@prisma/client";
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
  async function createApiKeyAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => createApiKey(formData), "/settings");
  }
  async function revokeApiKeyAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => revokeApiKey(formData), "/settings");
  }
  async function addWebhookEndpointAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => addWebhookEndpoint(formData), "/settings");
  }
  async function deleteWebhookEndpointAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => deleteWebhookEndpoint(formData), "/settings");
  }
  async function startCheckoutAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => startCheckout(formData), "/settings");
  }
  async function openBillingPortalAction() {
    "use server";
    await runOrRedirect(() => openBillingPortal(), "/settings");
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
  // Same one-time-display pattern for a just-created API key / webhook signing secret
  // (src/lib/actions/apiKeys.ts, src/lib/actions/webhooks.ts).
  const newApiKey = cookieStore.get("closecheck_new_api_key")?.value;
  const newWebhookSecret = cookieStore.get("closecheck_new_webhook_secret")?.value;

  const apiKeys = await withOrgScope(orgId, (tx) =>
    tx.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
  );
  const webhookEndpoints = await withOrgScope(orgId, (tx) =>
    tx.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" } }),
  );

  const billingConfigured = isBillingConfigured();
  const { billingAccount, creditBalance, recentLedger, recentEmails } = await withOrgScope(
    orgId,
    async (tx) => ({
      billingAccount: await tx.billingAccount.findUnique({ where: { orgId } }),
      creditBalance: await getCreditBalance(tx, orgId),
      recentLedger: await tx.auditCreditEntry.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
      recentEmails: await tx.emailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    }),
  );

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

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">Plan &amp; billing</h2>
        <p className="mt-1 text-xs text-slate-500">
          Base plan includes a yearly bundle of full audits; additional audits are batched onto your
          next monthly invoice, never charged one-by-one (docs/spec.md §9). Tier A checks are always
          unmetered. Only the account owner can change the plan.
        </p>

        {!billingConfigured ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Billing isn&apos;t configured on this deployment yet (no Stripe keys) — everything runs
            without limits. Plans appear here once it is.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {billingAccount?.plan ? PLAN_LABELS[billingAccount.plan] : "No plan"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  billingAccount?.status === "ACTIVE"
                    ? "bg-emerald-50 text-emerald-700"
                    : billingAccount?.status === "PAST_DUE"
                      ? "bg-amber-50 text-amber-800"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                {billingAccount?.status ?? "NONE"}
              </span>
              <span className="text-slate-600">
                Audit credits: <span className="font-medium text-slate-900">{creditBalance}</span>
              </span>
              {!isEnforcementEnabled() && (
                <span className="text-xs text-slate-400">(enforcement off — nothing is blocked yet)</span>
              )}
            </div>

            {isOwner && (
              <div className="mt-3 flex flex-wrap gap-2">
                {billingAccount?.stripeSubscriptionId && billingAccount.status !== "CANCELED" ? (
                  // Any live-or-past-due subscription is managed in the portal — showing checkout
                  // buttons for a PAST_DUE org would let it open a second subscription (startCheckout
                  // refuses this too; the UI just shouldn't offer it).
                  <form action={openBillingPortalAction}>
                    <button
                      type="submit"
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Manage subscription &amp; invoices
                    </button>
                  </form>
                ) : (
                  Object.values(BillingPlan).map((plan) => (
                    <form key={plan} action={startCheckoutAction}>
                      <input type="hidden" name="plan" value={plan} />
                      <button
                        type="submit"
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                          plan.endsWith("ANNUAL")
                            ? "bg-slate-900 text-white hover:bg-slate-800"
                            : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {PLAN_LABELS[plan]}
                      </button>
                    </form>
                  ))
                )}
              </div>
            )}

            {recentLedger.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 text-xs text-slate-600">
                {recentLedger.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between py-1.5">
                    <span>
                      {entry.reason}
                      {entry.note ? ` — ${entry.note}` : ""}
                    </span>
                    <span className="font-mono">
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta} ·{" "}
                      {entry.createdAt.toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">Email delivery</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every system email (invites, portal links, receipts) is recorded here.{" "}
          <span className="font-medium">LOGGED</span> means no email provider is configured yet — the
          message was recorded instead of delivered, and the in-app relay (e.g. the invite temp
          password above) is the delivery path.
        </p>
        {recentEmails.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No emails yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-xs">
            {recentEmails.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="truncate text-slate-700">
                  <span className="font-medium">{m.template}</span> → {m.to} — {m.subject}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                    m.status === "SENT"
                      ? "bg-emerald-50 text-emerald-700"
                      : m.status === "LOGGED"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-red-50 text-red-700"
                  }`}
                  title={m.error ?? undefined}
                >
                  {m.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">API keys</h2>
        <p className="mt-1 text-xs text-slate-500">
          Read-only access to this firm&apos;s engagements, audits, and report metadata for your own
          tooling (docs/spec.md §13.2). Pass a key as{" "}
          <code className="rounded bg-slate-100 px-1">Authorization: Bearer cc_live_...</code> to{" "}
          <code className="rounded bg-slate-100 px-1">/api/v1/engagements</code>. Only the account
          owner can create or revoke keys.
        </p>

        {newApiKey && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Your new API key</p>
            <p className="mt-1 break-all font-mono text-xs">{newApiKey}</p>
            <p className="mt-1 text-xs text-amber-700">
              Shown once — store it now. CloseCheck keeps only a hash and cannot show it again.
            </p>
          </div>
        )}

        {apiKeys.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {apiKeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-medium text-slate-900">{k.name}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{k.tokenPrefix}…</span>
                  {k.revokedAt ? (
                    <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                      revoked {k.revokedAt.toISOString().slice(0, 10)}
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-slate-400">
                      {k.lastUsedAt
                        ? `last used ${k.lastUsedAt.toISOString().slice(0, 10)}`
                        : "never used"}
                    </span>
                  )}
                </div>
                {isOwner && !k.revokedAt && (
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="apiKeyId" value={k.id} />
                    <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-700">
                      Revoke
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner && (
          <form action={createApiKeyAction} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              name="name"
              placeholder="Key name (e.g. deal-tracker sync)"
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Create key
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-900">Webhooks</h2>
        <p className="mt-1 text-xs text-slate-500">
          CloseCheck POSTs signed <code className="rounded bg-slate-100 px-1">audit.completed</code>{" "}
          and <code className="rounded bg-slate-100 px-1">report.generated</code> events to each
          endpoint (docs/spec.md §13.3). Payloads carry identifiers and status only — use the API
          above for detail. Verify the{" "}
          <code className="rounded bg-slate-100 px-1">X-CloseCheck-Signature</code> header
          (HMAC-SHA256 of the raw body with your signing secret). Only the account owner can manage
          endpoints.
        </p>

        {newWebhookSecret && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Signing secret for your new endpoint</p>
            <p className="mt-1 break-all font-mono text-xs">{newWebhookSecret}</p>
            <p className="mt-1 text-xs text-amber-700">
              Shown once — configure it in your receiver now to verify delivery signatures.
            </p>
          </div>
        )}

        {webhookEndpoints.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {webhookEndpoints.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="break-all font-mono text-xs text-slate-900">{w.url}</span>
                  {w.lastSuccessAt && (
                    <span className="ml-2 text-xs text-emerald-700">
                      last delivered {w.lastSuccessAt.toISOString().slice(0, 10)}
                    </span>
                  )}
                  {w.lastFailureAt && (
                    <span className="ml-2 text-xs text-red-700" title={w.lastFailureReason ?? undefined}>
                      last failure {w.lastFailureAt.toISOString().slice(0, 10)}
                    </span>
                  )}
                </div>
                {isOwner && (
                  <form action={deleteWebhookEndpointAction}>
                    <input type="hidden" name="webhookEndpointId" value={w.id} />
                    <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-700">
                      Delete
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner && (
          <form action={addWebhookEndpointAction} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              name="url"
              type="url"
              placeholder="https://your-tool.example.com/webhooks/closecheck"
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add endpoint
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
