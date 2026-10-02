import Link from "next/link";
import { cookies } from "next/headers";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { updateOrgBranding, uploadOrgLogo, removeOrgLogo, acknowledgeDisclaimer } from "@/lib/actions/org";
import { inviteMember, removeMember } from "@/lib/actions/team";
import { createApiKey, revokeApiKey, consumeSecretReveals } from "@/lib/actions/apiKeys";
import { RevealOnce } from "./RevealOnce";
import { addWebhookEndpoint, deleteWebhookEndpoint } from "@/lib/actions/webhooks";
import { startCheckout, openBillingPortal } from "@/lib/actions/billing";
import { isBillingConfigured, isEnforcementEnabled, PLAN_LABELS } from "@/lib/billing/config";
import { getCreditBalance } from "@/lib/billing/credits";
import { BillingPlan } from "@prisma/client";
import { REPORT_DISCLAIMER_TEXT } from "@/lib/reports/disclaimer";
import { runOrRedirect } from "@/lib/actions/errorRedirect";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  cn,
  inputClass,
} from "@/components/ui";

/** A status dot carrying no text of its own, so a live row is separable from a retired one at a
    glance without adding a word to a page whose copy is asserted verbatim. */
function StatusDot({ tone }: { tone: "live" | "failed" | "idle" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "live" ? "bg-sev-green" : tone === "failed" ? "bg-sev-red" : "bg-ink-300",
      )}
    />
  );
}

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

  const disclaimerAcknowledged = !!org.disclaimerAcknowledgedAt;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link href="/engagements" className="hover:text-ink-700 hover:underline">
            ← Engagements
          </Link>
        }
        title="Firm branding"
        description={
          <>
            Your logo, name, and brand color appear on the cover and footer of every generated report
            — never CloseCheck&apos;s.
          </>
        }
      />

      {error && (
        <Callout tone="error" className="mb-6">
          {error}
        </Callout>
      )}

      {/* One column at phone width; two from xl, where the container is wide enough that a single
          stack of cards would be a 1100px-wide card holding a 300px input. The left column is what
          the firm IS (identity, the report gate, who is on it), the right is what the account DOES
          (money, integrations, delivery).

          DOM order is also read order, and the browser suites depend on it: the firm-name input must
          stay the page's first input[name="name"], and the invite temp password the first .font-mono
          — so the columns are ordered containers, never reflowed. */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-6">
          {/* Side by side where the row has the full container, stacked again once it is one column
              of two — two 260px cards is worse than one of each. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-1">
            <Card key={`${org.name}-${org.brandColorHex}`} as="section">
              <CardHeader title="Firm name and color" />
              {/* Firm-scoped (spec.md §3): this rewrites the branding on every report the firm has ever
                  issued. Enforced server-side — rendering the form to a member anyway would be a control
                  that presents itself and then refuses, which is the same failure as a message telling
                  someone to do what only an owner can. The values stay visible, because a member needs to
                  know what is on the reports they produce; only the control is owner-only. */}
              <CardBody>
                {!isOwner && (
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                      {org.name}
                      {org.brandColorHex && (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-ink-50 px-2 py-0.5 text-xs font-normal text-ink-600">
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-ink-300"
                            style={{ backgroundColor: org.brandColorHex }}
                          />
                          {org.brandColorHex}
                        </span>
                      )}
                    </p>
                    <p className="mt-2 text-xs text-ink-500">
                      Your account owner sets the firm&apos;s name and colour.
                    </p>
                  </div>
                )}
                {isOwner && (
                  <form action={updateOrgBrandingAction} className="space-y-4">
                    <Field label="Firm name" htmlFor="name">
                      <input
                        id="name"
                        name="name"
                        defaultValue={org.name}
                        required
                        className={inputClass()}
                      />
                    </Field>
                    <Field label="Brand color" htmlFor="brandColorHex" hint="Blank = default (#0f172a).">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-9 w-9 shrink-0 rounded-md border border-ink-300 shadow-xs"
                          style={{ backgroundColor: org.brandColorHex || "#0f172a" }}
                        />
                        <input
                          id="brandColorHex"
                          name="brandColorHex"
                          defaultValue={org.brandColorHex ?? ""}
                          placeholder="#0f172a"
                          className={inputClass()}
                        />
                      </div>
                    </Field>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                )}
              </CardBody>
            </Card>

            <Card as="section">
              <CardHeader title="Logo" />
              <CardBody className="space-y-4">
                <div className="flex min-w-0 flex-wrap items-center gap-4">
                  {org.brandLogoUrl ? (
                    // Cache-busted with updatedAt so the preview reflects a just-replaced logo immediately —
                    // /api/branding/logo itself is always served no-store, but the <img> tag's src is
                    // otherwise identical across uploads and the browser's own image cache can still short-
                    // circuit the request without a query-string change.
                    // eslint-disable-next-line @next/next/no-img-element -- external-route-served, not a static/optimizable asset
                    <img
                      src={`/api/branding/logo?t=${org.updatedAt.getTime()}`}
                      alt="Firm logo"
                      className="h-16 w-auto max-w-full rounded-md border border-ink-200 bg-white p-1.5"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-ink-300 bg-ink-50 text-xs text-ink-400">
                      No logo
                    </div>
                  )}
                  {!isOwner && (
                    <p className="text-xs text-ink-500">Your account owner sets the firm&apos;s logo.</p>
                  )}
                  {isOwner && org.brandLogoUrl && (
                    <form action={removeOrgLogoAction}>
                      <Button type="submit" variant="ghost" size="sm">
                        Remove
                      </Button>
                    </form>
                  )}
                </div>
                {isOwner && (
                  <form
                    action={uploadOrgLogoAction}
                    className="flex min-w-0 flex-wrap items-center gap-2 border-t border-ink-100 pt-4"
                  >
                    {/* min-w-0/max-w-full: a native file input reports a wide intrinsic width and was one
                        of the controls that overflowed a 400px viewport. */}
                    <input
                      type="file"
                      name="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      required
                      className="min-w-0 max-w-full text-sm text-ink-600 file:mr-3 file:rounded-md file:border file:border-ink-300 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-ink-800 hover:file:bg-ink-50"
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      Upload
                    </Button>
                  </form>
                )}
              </CardBody>
            </Card>
          </div>

          {/* The one firm-wide switch on this page: until it is accepted, nobody in the firm can
              generate a report. Styled as a gate, not as a form field. */}
          <Card as="section" className={cn(!disclaimerAcknowledged && "border-sev-amber-border")}>
            <CardHeader
              title="Report disclaimer"
              description={
                <>
                  Every generated report includes this language. It has to be accepted once, on the
                  firm&apos;s behalf, before any report can be generated.
                </>
              }
            />
            <CardBody className="space-y-4">
              <blockquote className="rounded-md border-l-2 border-ink-300 bg-ink-50 px-4 py-3 text-sm leading-relaxed text-ink-700">
                {REPORT_DISCLAIMER_TEXT}
              </blockquote>
              {org.disclaimerAcknowledgedAt ? (
                <Callout tone="success">
                  Reviewed on {org.disclaimerAcknowledgedAt.toISOString().slice(0, 10)}.
                </Callout>
              ) : !isOwner ? (
                <Callout tone="warning">
                  Your account owner needs to accept this language before anyone in the firm can generate
                  a report.
                </Callout>
              ) : (
                <Callout tone="warning">
                  <form action={acknowledgeDisclaimerAction}>
                    <Button type="submit">
                      I&apos;ve reviewed this language — enable report generation
                    </Button>
                  </form>
                </Callout>
              )}
            </CardBody>
          </Card>

          <Card as="section">
            <CardHeader
              title="Team"
              description={
                <>
                  Everyone listed here shares this firm&apos;s engagements, templates, and branding Only
                  the account owner can invite or remove teammates.
                </>
              }
            />
            <CardBody className="space-y-4">
              {invitedEmail && invitedTempPassword && (
                // Same one-time-secret treatment as RevealOnce: the only moment this password exists on
                // screen. The .font-mono element holds nothing but the password — a browser suite reads
                // the page's first .font-mono to sign the new member in.
                <div className="overflow-hidden rounded-md border border-sev-amber-border bg-sev-amber-bg">
                  <p className="border-b border-sev-amber-border/70 px-3.5 py-2 text-sm font-semibold text-sev-amber">
                    Temporary password for {invitedEmail}
                  </p>
                  <div className="px-3.5 py-3">
                    <p className="rounded-md border border-sev-amber-border bg-white px-3 py-2 font-mono text-xs break-all text-ink-900 select-all">
                      {invitedTempPassword}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-sev-amber">
                      Shown here for one minute, in this browser only — relay it to them yourself. There is no invite-email sending yet (Phase 2
                      placeholder); this password won&apos;t be shown again after you leave this page.
                    </p>
                  </div>
                </div>
              )}

              <ul className="divide-y divide-ink-100">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-ink-900">{m.name || m.email}</span>
                      {m.name && <span className="text-sm text-ink-500">{m.email}</span>}
                      {/* Not <Badge>: owner and member need two different surfaces, and overriding the
                          primitive's own background utility is a class-order coin toss. */}
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase",
                          m.role === "OWNER"
                            ? "bg-accent-50 text-accent-800"
                            : "border border-ink-200 bg-white text-ink-600",
                        )}
                      >
                        {m.role}
                      </span>
                    </div>
                    {isOwner && (
                      <form action={removeMemberAction}>
                        <input type="hidden" name="userId" value={m.id} />
                        <Button type="submit" variant="danger" size="sm">
                          Remove
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>

              {isOwner && (
                <form
                  action={inviteMemberAction}
                  className="grid grid-cols-1 gap-2 border-t border-ink-100 pt-4 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <input
                    name="email"
                    type="email"
                    placeholder="teammate@example.com"
                    required
                    className={inputClass()}
                  />
                  <input name="name" placeholder="Name (optional)" className={inputClass()} />
                  <Button type="submit" variant="secondary">
                    Invite
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card as="section">
            <CardHeader
              title={<>Plan &amp; billing</>}
              description="Base plan includes a yearly bundle of full audits; additional audits are batched onto your next monthly invoice, never charged one-by-one. Tier A checks are always unmetered. Only the account owner can change the plan."
            />
            <CardBody className="space-y-4">
              {!billingConfigured ? (
                <Callout tone="neutral">
                  Billing isn&apos;t configured on this deployment yet (no Stripe keys) — everything runs
                  without limits. Plans appear here once it is.
                </Callout>
              ) : (
                <>
                  <div className="rounded-md border border-ink-200 bg-ink-50 px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                      <span className="rounded-md border border-ink-200 bg-white px-2 py-0.5 text-xs font-semibold text-ink-800">
                        {billingAccount?.plan ? PLAN_LABELS[billingAccount.plan] : "No plan"}
                      </span>
                      <span
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
                          billingAccount?.status === "ACTIVE"
                            ? "sev-green"
                            : billingAccount?.status === "PAST_DUE"
                              ? "sev-amber"
                              : "sev-none",
                        )}
                      >
                        {billingAccount?.status ?? "NONE"}
                      </span>
                      <span className="text-ink-600">
                        Audit credits:{" "}
                        <span className="font-semibold text-ink-900">{creditBalance}</span>
                      </span>
                    </div>
                    {!isEnforcementEnabled() && (
                      <p className="mt-2 text-xs text-ink-500">
                        (enforcement off — nothing is blocked yet)
                      </p>
                    )}
                  </div>

                  {isOwner && (
                    <div className="flex flex-wrap gap-2">
                      {billingAccount?.stripeSubscriptionId && billingAccount.status !== "CANCELED" ? (
                        // Any live-or-past-due subscription is managed in the portal — showing checkout
                        // buttons for a PAST_DUE org would let it open a second subscription (startCheckout
                        // refuses this too; the UI just shouldn't offer it).
                        <form action={openBillingPortalAction}>
                          <Button type="submit" variant="secondary">
                            Manage subscription &amp; invoices
                          </Button>
                        </form>
                      ) : (
                        Object.values(BillingPlan).map((plan) => (
                          <form key={plan} action={startCheckoutAction}>
                            <input type="hidden" name="plan" value={plan} />
                            {/* Annual leads (docs/research pricing pass): it is the dark button, the
                                monthly equivalents are the quiet ones beside it. */}
                            <Button type="submit" variant={plan.endsWith("ANNUAL") ? "primary" : "secondary"}>
                              {PLAN_LABELS[plan]}
                            </Button>
                          </form>
                        ))
                      )}
                    </div>
                  )}

                  {recentLedger.length > 0 && (
                    <ul className="divide-y divide-ink-100 border-t border-ink-100 text-xs text-ink-600">
                      {recentLedger.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2"
                        >
                          <span className="min-w-0">
                            {entry.reason}
                            {entry.note ? ` — ${entry.note}` : ""}
                          </span>
                          <span className="font-mono text-ink-500">
                            {entry.delta > 0 ? `+${entry.delta}` : entry.delta} ·{" "}
                            {entry.createdAt.toISOString().slice(0, 10)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card as="section">
            <CardHeader
              title="API keys"
              description={
                <>
                  Read-only access to this firm&apos;s engagements, audits, and report metadata for your
                  own tooling. Pass a key as{" "}
                  <code className="rounded bg-ink-100 px-1 text-ink-700">
                    Authorization: Bearer cc_live_...
                  </code>{" "}
                  to <code className="rounded bg-ink-100 px-1 text-ink-700">/api/v1/engagements</code>.
                  Only the account owner can create or revoke keys.
                </>
              }
            />
            <CardBody className="space-y-4">
              {/* Always mounted: it keeps the secret in client state across the refresh its own
                  consume() triggers (see RevealOnce). */}
              <RevealOnce
                title="Your new API key"
                value={newApiKey ?? null}
                hint="Shown once — store it now. CloseCheck keeps only a hash and cannot show it again."
                consume={consumeSecretReveals}
              />

              {apiKeys.length > 0 && (
                <ul className="divide-y divide-ink-100">
                  {apiKeys.map((k) => (
                    <li
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusDot tone={k.revokedAt ? "idle" : "live"} />
                        <span
                          className={cn(
                            "text-sm font-medium",
                            k.revokedAt ? "text-ink-500" : "text-ink-900",
                          )}
                        >
                          {k.name}
                        </span>
                        <span className="font-mono text-xs text-ink-500">{k.tokenPrefix}…</span>
                        {k.revokedAt ? (
                          <span className="rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap sev-red">
                            revoked {k.revokedAt.toISOString().slice(0, 10)}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-400">
                            {k.lastUsedAt
                              ? `last used ${k.lastUsedAt.toISOString().slice(0, 10)}`
                              : "never used"}
                          </span>
                        )}
                      </div>
                      {isOwner && !k.revokedAt && (
                        <form action={revokeApiKeyAction}>
                          <input type="hidden" name="apiKeyId" value={k.id} />
                          <Button type="submit" variant="danger" size="sm">
                            Revoke
                          </Button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {isOwner && (
                <form
                  action={createApiKeyAction}
                  className="grid grid-cols-1 gap-2 border-t border-ink-100 pt-4 sm:grid-cols-[1fr_auto]"
                >
                  <input
                    name="name"
                    placeholder="Key name (e.g. deal-tracker sync)"
                    required
                    className={inputClass()}
                  />
                  <Button type="submit" variant="secondary">
                    Create key
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>

          <Card as="section">
            <CardHeader
              title="Webhooks"
              description={
                <>
                  CloseCheck POSTs signed{" "}
                  <code className="rounded bg-ink-100 px-1 text-ink-700">audit.completed</code> and{" "}
                  <code className="rounded bg-ink-100 px-1 text-ink-700">report.generated</code> events
                  to each endpoint. Payloads carry identifiers and status only — use the API above for
                  detail. Verify the{" "}
                  <code className="rounded bg-ink-100 px-1 text-ink-700">X-CloseCheck-Signature</code>{" "}
                  header (HMAC-SHA256 of the raw body with your signing secret). Only the account owner
                  can manage endpoints.
                </>
              }
            />
            <CardBody className="space-y-4">
              <RevealOnce
                title="Signing secret for your new endpoint"
                value={newWebhookSecret ?? null}
                hint="Shown once — configure it in your receiver now to verify delivery signatures."
                consume={consumeSecretReveals}
              />

              {webhookEndpoints.length > 0 && (
                <ul className="divide-y divide-ink-100">
                  {webhookEndpoints.map((w) => (
                    <li
                      key={w.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-1.5">
                          <StatusDot
                            tone={w.lastFailureAt ? "failed" : w.lastSuccessAt ? "live" : "idle"}
                          />
                        </span>
                        <div className="min-w-0">
                          <span className="block break-all font-mono text-xs text-ink-900">{w.url}</span>
                          {w.lastSuccessAt && (
                            <span className="mt-0.5 block text-xs text-sev-green">
                              last delivered {w.lastSuccessAt.toISOString().slice(0, 10)}
                            </span>
                          )}
                          {w.lastFailureAt && (
                            <span
                              className="mt-0.5 block text-xs text-sev-red"
                              title={w.lastFailureReason ?? undefined}
                            >
                              last failure {w.lastFailureAt.toISOString().slice(0, 10)}
                            </span>
                          )}
                        </div>
                      </div>
                      {isOwner && (
                        <form action={deleteWebhookEndpointAction}>
                          <input type="hidden" name="webhookEndpointId" value={w.id} />
                          <Button type="submit" variant="danger" size="sm">
                            Delete
                          </Button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {isOwner && (
                <form
                  action={addWebhookEndpointAction}
                  className="grid grid-cols-1 gap-2 border-t border-ink-100 pt-4 sm:grid-cols-[1fr_auto]"
                >
                  <input
                    name="url"
                    type="url"
                    placeholder="https://your-tool.example.com/webhooks/closecheck"
                    required
                    className={inputClass()}
                  />
                  <Button type="submit" variant="secondary">
                    Add endpoint
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>

          <Card as="section">
            <CardHeader
              title="Email delivery"
              description={
                <>
                  Every system email (invites, portal links, receipts) is recorded here.{" "}
                  <span className="font-medium text-ink-700">LOGGED</span> means no email provider is
                  configured yet — the message was recorded instead of delivered, and the in-app relay
                  (e.g. the invite temp password above) is the delivery path.
                </>
              }
            />
            {recentEmails.length === 0 ? (
              <EmptyState title="No emails yet." />
            ) : (
              <CardBody>
                <ul className="divide-y divide-ink-100 text-xs">
                  {recentEmails.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="truncate text-ink-600">
                        <span className="font-medium text-ink-900">{m.template}</span> → {m.to} —{" "}
                        {m.subject}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                          m.status === "SENT" ? "sev-green" : m.status === "LOGGED" ? "sev-none" : "sev-red",
                        )}
                        title={m.error ?? undefined}
                      >
                        {m.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
