import Link from "next/link";
import { getCreditBalance } from "@/lib/billing/credits";
import { isBillingConfigured, isEnforcementEnabled } from "@/lib/billing/config";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { Tier } from "@prisma/client";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { listReportExports } from "@/lib/reports/exportTrail";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import { runTierAAutomation, updateFinding, updateAuditOverride, markAuditComplete, reopenAudit } from "@/lib/actions/audits";
import { generateReport } from "@/lib/actions/reports";
import { attachEvidence, citeEvidence, deleteEvidence } from "@/lib/actions/evidence";
import { parseFieldSchema, readPersistedValues } from "@/lib/templates/fieldSchema";
import { citationsByField } from "@/lib/audit/sourceRef";
import { recallFields, vendorKeyFor, vendorLabelFor } from "@/lib/audit/vendorMemory";
import { formatFieldValue } from "@/lib/templates/fieldSchema";
import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Meter,
  SeverityBadge,
  SeverityDot,
  TierChip,
  TIER_META,
  buttonClass,
  cn,
  inputClass,
  selectClass,
} from "@/components/ui";
import { VendorRecall } from "./VendorRecall";
import { FindingDraftKeeper } from "./FindingDraftKeeper";
import { PendingSubmit } from "./PendingSubmit";
import { StructuredFields } from "./StructuredFields";
import { FieldSources } from "./FieldCitations";
import { BlockingChip, EvidenceChip, FindingGuidance } from "./FindingGuidance";
import { PortalAccessHistory } from "./PortalAccessHistory";
import { ReportExportTrail } from "./ReportExportTrail";
import { attributionFor, describeEvidence } from "@/lib/storage/describeEvidence";
import { unavailableReason } from "@/lib/audit/blocking";
import { computeEvidenceCoverage, isEvidenceSatisfied } from "@/lib/reports/evidenceCoverage";
import { createPortalLink, revokePortalLink, emailPortalLink } from "@/lib/actions/portal";
import { runOrRedirect, userFacingMessage } from "@/lib/actions/errorRedirect";
import { recordError } from "@/lib/metrics/record";

const TIER_LABEL: Record<Tier, string> = {
  A: "Tier A — External (no seller cooperation needed)",
  B: "Tier B — Seller/broker-provided documents",
  C: "Tier C — Live access verification",
};

const TIERS = Object.keys(TIER_LABEL) as Tier[];

/** In-page jump targets, shared by the header tiles and the sections they point at. */
const TIER_ANCHOR: Record<Tier, string> = { A: "tier-a", B: "tier-b", C: "tier-c" };

/** The anchor on a finding card, shared by the jump links and by the post-save redirects. */
const findingAnchorId = (findingId: string) => `finding-${findingId}`;

/**
 * The file picker's filter, mirroring ALLOWED_EVIDENCE_MIME_TYPES in
 * src/lib/storage/uploadPolicy.ts. A hint only — the server stays the authority and still refuses
 * on declared type AND on the file's own leading bytes — but without it the control a consultant
 * uses 20+ times an audit offered no filter at all while the once-per-firm logo upload did.
 * Spelled out here rather than imported because that list is not exported; exporting it (and
 * deriving this) is the tidier fix and belongs in that file's own change.
 */
const EVIDENCE_ACCEPT = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/rtf",
  "text/rtf",
].join(",");

/**
 * Reads the finding a submission belongs to, so the redirect can come back to its card.
 *
 * Whitelisted rather than merely escaped: this value reaches a redirect target, and the only thing
 * that ever legitimately sits in it is a cuid. (b-engagements-audits row B11 rewrites this field in
 * the DOM on purpose, so "it comes from our own markup" is not an assumption this code may make.)
 */
function findingAnchor(formData: FormData): string | null {
  const value = formData.get("findingId");
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

/**
 * The finding-scoped twin of runOrRedirect: identical error handling, plus it carries WHICH finding
 * the consultant was working on through both outcomes. Without it, every one of the ~24 saves on
 * this page lands the browser at y=0 of a 17-screen document and the consultant has to find their
 * place again — measured, not supposed.
 *
 * Not expressed by handing runOrRedirect a path that already ends in `#finding-…`: it builds its
 * failure URL as `${path}?error=…`, and everything after the first `#` is the fragment, so the
 * query string would end up INSIDE the fragment and the error banner would never render at all
 * (b-findings-evidence row B5 drives exactly that refusal). Hence the query first and the fragment
 * appended last, on each branch.
 *
 * The id also travels as a search param because a fragment is never sent to the server, and the
 * page needs it server-side to mark the card that failed and the card that saved.
 *
 * Module scope, NOT a local function inside the component, even though it only has one caller
 * there: the inline `"use server"` actions below would then CLOSE OVER it, and Next serialises an
 * inline action's captured variables — a captured function is not serialisable, so every render of
 * this page threw "Functions cannot be passed directly to Client Components" and the whole audit
 * page fell to the error boundary. An imported or module-level function is a module reference
 * instead, which is why runOrRedirect itself was always fine.
 */
async function runForFinding(
  action: () => Promise<void>,
  backPath: string,
  findingId: string | null,
) {
  if (!findingId) {
    await runOrRedirect(action, backPath);
    return;
  }
  try {
    await action();
  } catch (err) {
    unstable_rethrow(err);
    // Fire-and-forget, as in runOrRedirect: recording must never delay or alter the redirect.
    void recordError("server-action", err);
    redirect(
      `${backPath}?error=${encodeURIComponent(userFacingMessage(err))}` +
        `&finding=${findingId}#${findingAnchorId(findingId)}`,
    );
  }
  redirect(`${backPath}?saved=${findingId}#${findingAnchorId(findingId)}`);
}

/** Small meta chip on a finding card (method, and alongside the blocking/evidence chips). */
const META_CHIP =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

/** Section eyebrow used for the secondary blocks inside a finding card. */
const EYEBROW = "text-[11px] font-semibold tracking-wide text-ink-400 uppercase";

/**
 * Compact control styling for the two secondary strips (evidence label, override note), written out
 * rather than passed into inputClass as overrides: Tailwind emits same-property utilities in scale
 * order, so a `py-1` handed to a helper already carrying `py-2` loses to it whatever the class order.
 */
const DENSE_INPUT =
  "block rounded-md border border-ink-300 bg-white px-2 py-1.5 text-xs text-ink-900 " +
  "placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-500 focus:outline-none";

/**
 * "Mark audit complete" keeps its green reading, spelled out instead of layered over
 * buttonClass("secondary") — that would leave `border-ink-300` and `border-sev-green-border` both in
 * the class list, with the winner decided by token order in globals.css rather than by this file.
 */
const COMPLETE_BUTTON =
  "inline-flex items-center justify-center rounded-md border border-sev-green-border bg-white " +
  "px-3.5 py-2 text-sm font-medium text-sev-green shadow-xs transition-colors hover:bg-sev-green-bg";

/**
 * Shared by the overall badge, each per-tier badge, and the historical reports list — all three need
 * the same three-way read: total === 0 means every item in scope was NOT_APPLICABLE (excluded from
 * computeSeverityRollup's denominator entirely, src/lib/reports/rollup.ts), which is a resolved
 * state, not pending work, so it must render differently from "not-yet-rated" (total > 0, rated ===
 * 0) even though both have rated === 0. A plain discriminator rather than a shared component since
 * each call site's markup (dot size, whether a text label accompanies the dot) already differs.
 */
function coverageStatus(rated: number, total: number): "not-applicable" | "not-yet-rated" | "rated" {
  if (total === 0) return "not-applicable";
  if (rated === 0) return "not-yet-rated";
  return "rated";
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; auditId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; finding?: string }>;
}) {
  const { id: engagementId, auditId } = await params;
  const { error, saved: savedFindingId, finding: failedFindingId } = await searchParams;
  const { orgId, userId } = await requireOrgSession();
  const backPath = `/engagements/${engagementId}/audits/${auditId}`;
  // The "this audit is now billable" moment a consultant should see coming (spec.md §9): Tier A
  // screening is included; the first Tier B/C entry consumes a credit. Read here, not inferred.
  const creditBalance = isBillingConfigured()
    ? await withOrgScope(orgId, (tx) => getCreditBalance(tx, orgId))
    : null;

  async function runTierAAutomationAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => runTierAAutomation(formData), backPath);
  }
  async function generateReportAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => generateReport(formData), backPath);
  }
  async function markAuditCompleteAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => markAuditComplete(formData), backPath);
  }
  async function reopenAuditAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => reopenAudit(formData), backPath);
  }
  async function updateAuditOverrideAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => updateAuditOverride(formData), backPath);
  }
  async function createPortalLinkAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => createPortalLink(formData), backPath);
  }
  async function revokePortalLinkAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => revokePortalLink(formData), backPath);
  }
  async function emailPortalLinkAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => emailPortalLink(formData), backPath);
  }
  async function updateFindingAction(formData: FormData) {
    "use server";
    await runForFinding(() => updateFinding(formData), backPath, findingAnchor(formData));
  }
  async function attachEvidenceAction(formData: FormData) {
    "use server";
    await runForFinding(() => attachEvidence(formData), backPath, findingAnchor(formData));
  }
  // Evidence removal and citation stay on the plain path: neither form carries a findingId (they
  // are addressed by evidenceId / fieldKey), and adding one would be adding a form control to a
  // page whose controls the browser suites address by name.
  async function deleteEvidenceAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => deleteEvidence(formData), backPath);
  }
  async function citeEvidenceAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => citeEvidence(formData), backPath);
  }

  const audit = await withOrgScope(orgId, (tx) =>
    tx.audit.findUnique({
      where: { id: auditId },
      include: {
        engagement: true,
        template: true,
        findings: {
          include: {
            templateItem: true,
            evidence: {
              orderBy: { createdAt: "desc" },
              include: { uploadedBy: { select: { name: true, email: true } } },
            },
          },
          orderBy: { templateItem: { sortOrder: "asc" } },
        },
      },
    }),
  );
  if (!audit || audit.engagementId !== engagementId) notFound();

  const reports = await withOrgScope(orgId, (tx) =>
    tx.report.findMany({ where: { auditId }, orderBy: { generatedAt: "desc" } }),
  );

  // What this firm recorded about the same vendors on earlier engagements. Loaded in one query for
  // the whole audit rather than per finding, and scoped to this audit's item titles so an org with
  // a long history doesn't pull its entire library to render one page.
  const auditItemTitles = [...new Set(audit.findings.map((f) => f.templateItem.title))];
  // Excluding this engagement's own readings at the query, not after: "what we found last time"
  // has to mean a different deal, and a reading from this one is the consultant's own current
  // answer reflected back at them.
  const vendorProfiles = await withOrgScope(orgId, (tx) =>
    tx.vendorTermProfile.findMany({
      where: { itemTitle: { in: auditItemTitles }, engagementId: { not: engagementId } },
      orderBy: { updatedAt: "desc" },
    }),
  );
  // Most recent other engagement wins: the list is already newest-first, so the first write for a
  // key is the one to keep.
  const vendorProfileByKey = new Map<string, (typeof vendorProfiles)[number]>();
  for (const profile of vendorProfiles) {
    const key = `${profile.itemTitle}::${profile.vendorKey}`;
    if (!vendorProfileByKey.has(key)) vendorProfileByKey.set(key, profile);
  }

  // Client Portal Links (spec.md §7) for these reports, with each link's access log (spec.md §8's
  // "who viewed/exported/shared a given Report and when," from the consultant's side — there's no
  // "who" for an anonymous buyer, just "when" and a hashed IP, so this list itself is the answer).
  const portalLinks = await withOrgScope(orgId, (tx) =>
    tx.clientPortalLink.findMany({
      where: { reportId: { in: reports.map((r) => r.id) } },
      include: {
        accessLog: { orderBy: { viewedAt: "desc" } },
        createdBy: { select: { name: true, email: true } },
        revokedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  );
  // spec.md §8's other half: exports belong to the REPORT, not to a link — a report can be exported
  // before it is ever shared and after every link is revoked, and those are exactly the cases a
  // consultant is asked about.
  const exportsByReport = await withOrgScope(orgId, async (tx) => {
    const byReport = new Map<string, Awaited<ReturnType<typeof listReportExports>>>();
    for (const r of reports) byReport.set(r.id, await listReportExports(tx, r.id));
    return byReport;
  });

  const portalLinksByReport = new Map<string, typeof portalLinks>();
  for (const link of portalLinks) {
    const existing = portalLinksByReport.get(link.reportId) ?? [];
    existing.push(link);
    portalLinksByReport.set(link.reportId, existing);
  }

  const { org, isOwner } = await withOrgScope(orgId, async (tx) => ({
    org: await tx.consultantOrg.findUniqueOrThrow({
      where: { id: orgId },
      select: { disclaimerAcknowledgedAt: true },
    }),
    // Read here, not from the session token, for the reason requireOwner documents: a token is
    // issued once and would not notice a demotion.
    isOwner: (await tx.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role === "OWNER",
  }));

  const rollup = computeSeverityRollup(audit.findings);
  const byTier: Record<Tier, typeof audit.findings> = { A: [], B: [], C: [] };
  for (const f of audit.findings) byTier[f.templateItem.tier].push(f);
  const overallStatus = coverageStatus(rollup.overallCoverage.rated, rollup.overallCoverage.total);
  // How much of the audit has evidence behind it, not just a rating on it. A Tier B item can be
  // marked Green with no contract attached and every field blank; without this the audit page
  // presents that identically to one backed by an executed agreement.
  const evidenceCoverage = computeEvidenceCoverage(audit.findings);
  const gated = !audit.engagement.primaryDomain || !org.disclaimerAcknowledgedAt;
  // "Where did I get to?" answered as a link rather than left to scrolling. Same definition of
  // rated the roll-up uses (severity set; NOT_APPLICABLE is resolved, not outstanding —
  // src/lib/reports/rollup.ts), and walked in tier order so it matches the order of the sections
  // below rather than the database's.
  const firstUnrated = TIERS.flatMap((tier) => byTier[tier]).find(
    (f) => f.severity === null && f.status !== "NOT_APPLICABLE",
  );

  return (
    <div>
      {/* Mounted once for the whole page: holds typed values across a refused save. Renders
          nothing, and every form above it keeps working if it never loads. */}
      <FindingDraftKeeper />
      {/*
        The save confirmation fades itself out. CSS rather than a timer in FindingDraftKeeper,
        because a save redirects through a CLIENT-SIDE navigation — a mounted effect does not re-run
        for one, so a JS timer would only ever fire on a full page load, which is not the path a
        save takes. The animation plays whenever the element is rendered, which is exactly when a
        save has just happened. `visibility` and not `display`, so the line does not reflow the card
        out from under a cursor already heading for the next control.
      */}
      <style>{
        "@keyframes cc-saved-out{0%,70%{opacity:1}100%{opacity:0;visibility:hidden}}" +
        ".cc-saved{animation:cc-saved-out 6s ease-out forwards}" +
        "@media (prefers-reduced-motion:reduce){.cc-saved{animation-duration:6s;animation-timing-function:step-end}}"
      }</style>
      {/*
        The audit's instrument panel: what this audit currently says, how much of it is real work,
        what is runnable versus waiting on somebody else, and the three actions that move it on.
        Composed as one surface because a consultant opening this mid-deal reads all four at once.
      */}
      <header className="mb-5 overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 pt-3 pb-4">
          <div className="min-w-0">
            <Link
              href={`/engagements/${engagementId}`}
              className="text-sm text-ink-500 hover:text-ink-800 hover:underline"
            >
              ← {audit.engagement.businessName}
            </Link>
            <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-ink-900">
              {audit.template.name} v{audit.template.version}
              {audit.status === "COMPLETE" && (
                <span className="rounded-md border border-sev-green-border bg-sev-green-bg px-2 py-0.5 text-[11px] font-semibold tracking-wide text-sev-green uppercase">
                  Complete
                </span>
              )}
            </h1>
          </div>
          <div className="min-w-0 sm:text-right">
            <div className="flex items-center gap-2 text-sm sm:justify-end">
              <span className="text-ink-500">Overall:</span>
              {overallStatus !== "rated" ? (
                <SeverityBadge
                  severity={null}
                  label={overallStatus === "not-applicable" ? "Not applicable" : "Not yet rated"}
                />
              ) : (
                <SeverityBadge severity={rollup.overall} label={rollup.overall} />
              )}
            </div>
            <span className="mt-1.5 block text-xs text-ink-500">
              ({rollup.overallCoverage.rated}/{rollup.overallCoverage.total} rated
              {rollup.overallCoverage.provisional > 0 &&
                `, ${rollup.overallCoverage.provisional} awaiting confirmation`}
              {evidenceCoverage.overall.expected > 0 &&
                ` · ${evidenceCoverage.overall.supported}/${evidenceCoverage.overall.expected} evidenced`}
              )
            </span>
            <div className="mt-2 sm:ml-auto sm:w-56">
              <Meter value={rollup.overallCoverage.rated} total={rollup.overallCoverage.total} />
            </div>
          </div>
        </div>

        {/*
          Tiers are grouped by WHO HAS TO ACT, not by sequence (spec.md §4) — so the first thing the
          panel answers is "what can I run right now and what am I waiting on". Colour, rail and
          blocker label all carry that, here and on every finding card below.
        */}
        <div className="grid gap-px border-t border-ink-200 bg-ink-200 sm:grid-cols-3">
          {TIERS.map((tier) => {
            const coverage = rollup.perTierCoverage[tier];
            const tierStatus = coverageStatus(coverage.rated, coverage.total);
            const evidence = evidenceCoverage.perTier[tier];
            return (
              // Each tile jumps to its own section. The panel already reads as a map of the page;
              // this makes it one, instead of a summary you then scroll past three tier headings
              // to reach. An anchor, not script: nothing here depends on hydration.
              <a key={tier} href={`#${TIER_ANCHOR[tier]}`} className="block bg-white px-3.5 py-3 transition-colors hover:bg-ink-50">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={cn("h-4 w-1 rounded-full", TIER_META[tier].rail)} />
                  <TierChip tier={tier}>Tier {tier}</TierChip>
                  {/* The glyph is aria-hidden inside SeverityDot, so without a title the tier's
                      rating was simply absent to a screen reader: "TIER A, 7 of 11, Runnable now"
                      and nothing about Red or Green. The title also gives a sighted first-time
                      reader a way to find out what ▲/◆/● mean, which the strip has no room to
                      spell out beside three tiles of counts. */}
                  {tierStatus === "rated" && (
                    <SeverityDot
                      severity={rollup.perTier[tier]}
                      title={`Tier ${tier}: ${rollup.perTier[tier]}`}
                    />
                  )}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-900">
                    {coverage.rated}/{coverage.total}
                  </span>
                  {evidence.expected > 0 && (
                    <span className="text-[11px] text-ink-500">
                      {evidence.supported}/{evidence.expected} evidenced
                    </span>
                  )}
                </div>
                <Meter value={coverage.rated} total={coverage.total} className="mt-1.5" />
                <div className="mt-1.5 text-[11px] text-ink-500">{TIER_META[tier].blocker}</div>
              </a>
            );
          })}
        </div>

        <div className="border-t border-ink-200 bg-ink-50 px-4 py-3">
          <div className="flex flex-wrap items-start gap-2">
            <form action={runTierAAutomationAction}>
              <input type="hidden" name="auditId" value={audit.id} />
              <button
                type="submit"
                disabled={!audit.engagement.primaryDomain}
                className={buttonClass("secondary")}
              >
                Run Tier A automated checks
              </button>
            </form>
            {/* The appendix option sits under its own button rather than beside it: in a row of
                three forms, a checkbox between two buttons reads as belonging to either. */}
            <form action={generateReportAction} className="flex flex-col items-start gap-1.5">
              <input type="hidden" name="auditId" value={audit.id} />
              {/* Report generation is the one action here that takes seconds and that CANNOT be
                  undone twice over — there is no way to delete a report once generated. See
                  PendingSubmit for why this one and nothing else on the page. */}
              <PendingSubmit
                disabled={!org.disclaimerAcknowledgedAt}
                // Transparent border only so the filled button matches the height of the bordered
                // ones beside it; the primary variant carries no border of its own.
                className={buttonClass("primary", "md", "border border-transparent")}
                pendingLabel="Generating…"
                pendingClassName="text-[11px] text-ink-500"
              >
                Generate report
              </PendingSubmit>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-600">
                <input type="checkbox" name="includeAppendix" className="accent-accent-600" />
                Include uploaded documents as an appendix
              </label>
            </form>
            <div className="sm:ml-auto">
              {audit.status === "COMPLETE" ? (
                <form action={reopenAuditAction}>
                  <input type="hidden" name="auditId" value={audit.id} />
                  <button type="submit" className={buttonClass("secondary")}>
                    Reopen audit
                  </button>
                </form>
              ) : (
                <form action={markAuditCompleteAction}>
                  <input type="hidden" name="auditId" value={audit.id} />
                  <button type="submit" className={COMPLETE_BUTTON}>
                    Mark audit complete
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* The one piece of wayfinding a consultant actually asks for mid-deal: not "how much is
              left" (the meters say that) but "take me to it". Absent once nothing is outstanding —
              a link to nowhere is worse than no link. */}
          {firstUnrated && (
            <div className="mt-2.5 text-xs">
              <a
                href={`#${findingAnchorId(firstUnrated.id)}`}
                className="font-medium text-accent-700 underline hover:text-accent-900"
              >
                Jump to the next item not yet rated
              </a>
              <span className="ml-1.5 text-ink-500">({firstUnrated.templateItem.title})</span>
            </div>
          )}

          {gated && (
            <div className="mt-2.5 space-y-1 text-xs leading-relaxed text-sev-amber">
              {!audit.engagement.primaryDomain && (
                <p>Set a primary domain on the engagement to enable Tier A automation.</p>
              )}
              {/* Two messages, because one sentence cannot be right for both readers. Accepting the
                  disclaimer is owner-only (src/lib/auth/requireOwner.ts), so a member needs to know who
                  to ask, and an owner needs to know it is them — "the account owner must accept" reads
                  to an owner as though they are waiting on somebody else. Same rule as the credit-limit
                  and branding messages: name who can resolve it rather than instructing the reader. */}
              {!org.disclaimerAcknowledgedAt && (
                <p>
                  {isOwner ? (
                    <>
                      Accept the report disclaimer on the{" "}
                      <Link href="/settings" className="underline">
                        Settings
                      </Link>{" "}
                      page to enable report generation.
                    </>
                  ) : (
                    "Report generation is disabled until your account owner accepts the report disclaimer."
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="space-y-3">
        {error && <Callout tone="error">{error}</Callout>}

        {rollup.overallCoverage.provisional > 0 && (
          <Callout tone="info">
            {rollup.overallCoverage.provisional}{" "}
            {rollup.overallCoverage.provisional === 1 ? "rating is" : "ratings are"} still marked in
            progress — the automated checks rate an item and set its status in one pass, so these
            carry a severity nobody has confirmed. Their own notes usually say what is left to do
            (&ldquo;this is a fingerprint, not an assertion&rdquo;). They count as rated everywhere,
            including in the report, so the number above overstates the work until you set a status.
          </Callout>
        )}

        {evidenceCoverage.unsupportedRatedCount > 0 && (
          <Callout tone="warning">
            {evidenceCoverage.unsupportedRatedCount}{" "}
            {evidenceCoverage.unsupportedRatedCount === 1 ? "finding is" : "findings are"} rated with no
            document or attestation behind{" "}
            {evidenceCoverage.unsupportedRatedCount === 1 ? "it" : "them"}. They will still appear in
            the report — this is a prompt, not a block, since a seller who won&rsquo;t produce a
            document is itself a finding.
          </Callout>
        )}

        {creditBalance !== null && (
          <Callout tone="neutral">
            {audit.creditConsumedAt ? (
              <>
                This audit used one audit credit on{" "}
                {audit.creditConsumedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}.
                Everything on it since is included.
              </>
            ) : (
              <>
                Tier A screening is included in your plan. The first Tier B or Tier C entry on this
                audit — a rating, a document, or a citation — uses one audit credit.{" "}
                {creditBalance > 0
                  ? `${creditBalance} remaining.`
                  : isEnforcementEnabled()
                    ? "None remaining: the next full audit is billed as an overage."
                    : // Enforcement off (the launch-gate default): the ledger records the overage and nothing
                      // invoices it. "Recorded as an overage" reads as "you will be charged" — a sentence
                      // that is literally true and that a consultant would act on as if it meant more.
                      "None remaining. Overage is being recorded but not billed yet."}
              </>
            )}
          </Callout>
        )}
      </div>

      <Card
        as="section"
        key={`${audit.overallRatingOverride}-${audit.overallRatingOverrideNote}`}
        className="mt-4"
      >
        <CardHeader
          title="Override computed rating"
          description="The computed rating above is always kept and shown — an override is added alongside it in the report, never in place of it."
        />
        <CardBody className="px-4 py-3">
          <form
            action={updateAuditOverrideAction}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
          >
            <input type="hidden" name="auditId" value={audit.id} />
            <select
              name="overallRatingOverride"
              aria-label="Override computed rating"
              defaultValue={audit.overallRatingOverride ?? ""}
              className={selectClass()}
            >
              <option value="">No override</option>
              <option value="GREEN">Green</option>
              <option value="YELLOW">Yellow</option>
              <option value="RED">Red</option>
            </select>
            {/* Named, not left to the placeholder: a placeholder is not an accessible name, and it
                also disappears the moment there is a value — so a consultant returning to an
                existing override, by keyboard or by screen reader, had no way to tell what the
                field was for. */}
            <input
              name="overallRatingOverrideNote"
              aria-label="Why the override — required context for the report reader"
              defaultValue={audit.overallRatingOverrideNote ?? ""}
              placeholder="Why the override — required context for the report reader"
              className={inputClass()}
            />
            <button type="submit" className={buttonClass("secondary")}>
              Save
            </button>
          </form>
        </CardBody>
      </Card>

      {reports.length > 0 && (
        <Card as="section" className="mt-4">
          <CardHeader title="Reports" />
          <ul className="divide-y divide-ink-100">
            {reports.map((r) => {
              const links = portalLinksByReport.get(r.id) ?? [];
              return (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-ink-600">
                      {r.generatedAt.toISOString().slice(0, 19).replace("T", " ")}
                    </span>{" "}
                    —{" "}
                    {coverageStatus(r.overallCoveredCount, r.overallTotalCount) !== "rated" ? (
                      <SeverityBadge
                        severity={null}
                        size="sm"
                        label={
                          coverageStatus(r.overallCoveredCount, r.overallTotalCount) === "not-applicable"
                            ? "Not applicable"
                            : "Not yet rated"
                        }
                      />
                    ) : (
                      <SeverityBadge
                        severity={r.computedOverallSeverity}
                        size="sm"
                        label={r.computedOverallSeverity}
                      />
                    )}
                    <span className="ml-1.5 text-xs text-ink-500">
                      ({r.overallCoveredCount}/{r.overallTotalCount} rated)
                    </span>
                  </span>
                  <div className="flex items-center gap-3 text-xs">
                    <a href={`/api/reports/${r.id}/pdf`} className="font-medium text-accent-700 underline hover:text-accent-900">
                      Download PDF
                    </a>
                    <form action={createPortalLinkAction}>
                      <input type="hidden" name="reportId" value={r.id} />
                      <button type="submit" className="font-medium text-accent-700 underline hover:text-accent-900">
                        Create client link
                      </button>
                    </form>
                  </div>
                </div>
                <ReportExportTrail exports={exportsByReport.get(r.id) ?? []} />

                {links.length > 0 && (
                  <ul className="mt-2 space-y-2 text-xs">
                    {links.map((link) => {
                      const isRevoked = Boolean(link.revokedAt);
                      const isExpired = link.expiresAt.getTime() < Date.now();
                      const isLive = !isRevoked && !isExpired;
                      return (
                        <li key={link.id} className="rounded-md border border-ink-200 bg-ink-50 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            {isLive ? (
                              <a
                                href={`/portal/${link.token}`}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate font-mono text-ink-700 underline"
                              >
                                /portal/{link.token}
                              </a>
                            ) : (
                              <span className="truncate font-mono text-ink-400 line-through">/portal/{link.token}</span>
                            )}
                            <span
                              className={cn(
                                "shrink-0 rounded-md border px-2 py-0.5 font-semibold tracking-wide uppercase",
                                isLive
                                  ? "border-sev-green-border bg-sev-green-bg text-sev-green"
                                  : "border-ink-200 bg-white text-ink-500",
                              )}
                            >
                              {isRevoked ? "Revoked" : isExpired ? "Expired" : "Live"}
                            </span>
                            {isLive && (
                              <form action={revokePortalLinkAction}>
                                <input type="hidden" name="linkId" value={link.id} />
                                <button type="submit" className="shrink-0 text-ink-500 underline hover:text-sev-red">
                                  Revoke
                                </button>
                              </form>
                            )}
                          </div>
                          <PortalAccessHistory
                            createdBy={attributionFor(link.createdBy)}
                            createdAt={link.createdAt}
                            expiresAt={link.expiresAt}
                            revokedAt={link.revokedAt}
                            revokedBy={attributionFor(link.revokedBy)}
                            accessLog={link.accessLog}
                          />
                          {isLive && (
                            <form action={emailPortalLinkAction} className="mt-2 flex items-center gap-2">
                              <input type="hidden" name="linkId" value={link.id} />
                              {/* One of these renders per live link, so the name carries the report
                                  it belongs to — "Buyer's email address" alone would repeat
                                  identically down a page listing several shareable links. */}
                              <input
                                name="recipientEmail"
                                type="email"
                                required
                                aria-label={`Buyer's email address to send this report link to (link ending ${link.token.slice(-6)})`}
                                placeholder="buyer@example.com"
                                className={cn(DENSE_INPUT, "w-48 max-w-full")}
                              />
                              <button type="submit" className={buttonClass("secondary", "sm")}>
                                Email link
                              </button>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
              );
            })}
          </ul>
        </Card>
      )}

      {TIERS.map((tier) => {
        const tierStatus = coverageStatus(rollup.perTierCoverage[tier].rated, rollup.perTierCoverage[tier].total);
        const meta = TIER_META[tier];
        return (
        <section key={tier} id={TIER_ANCHOR[tier]} className="mt-8 scroll-mt-4">
          {/* The tier's identity, repeated from the header panel and carried into every card's rail
              so a consultant scrolling the checklist never loses track of who has to act next. */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b-2 border-ink-200 pb-2">
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold",
                meta.chip,
              )}
            >
              {tier}
            </span>
            <h2 className="text-sm font-semibold text-ink-900">{TIER_LABEL[tier]}</h2>
            {tierStatus !== "rated" ? (
              <SeverityBadge
                severity={null}
                size="sm"
                label={tierStatus === "not-applicable" ? "Not applicable" : "Not yet rated"}
              />
            ) : (
              <SeverityBadge severity={rollup.perTier[tier]} size="sm" label={rollup.perTier[tier]} />
            )}
            <span className="text-xs text-ink-500">
              ({rollup.perTierCoverage[tier].rated}/{rollup.perTierCoverage[tier].total} rated
              {evidenceCoverage.perTier[tier].expected > 0 &&
                ` · ${evidenceCoverage.perTier[tier].supported}/${evidenceCoverage.perTier[tier].expected} evidenced`}
              )
            </span>
            <span className="ml-auto">
              <TierChip tier={tier}>{meta.blocker}</TierChip>
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {byTier[tier].map((finding) => {
              // A fieldSchema is honoured only on MANUAL items: structuredData doubles as the Tier A
              // automated runner's output store, and rendering a form over it would let a save
              // overwrite check results. Mirrors the same guard in updateFinding.
              const schema =
                finding.templateItem.method === "MANUAL"
                  ? parseFieldSchema(finding.templateItem.fieldSchema)
                  : null;
              const structured = schema ? readPersistedValues(schema, finding.structuredData) : {};
              // Citations are pinned to the same template version the finding was rated against:
              // a citation against a field a later version removed is dropped rather than rendered
              // attached to nothing.
              const citations = schema
                ? citationsByField(finding.evidence, new Set(schema.fields.map((f) => f.key)))
                : new Map();
              // Only recall a vendor this finding actually names, and never the profile this
              // finding itself wrote — showing a consultant their own current answer back as
              // "you audited this before" would be noise at best and misleading at worst.
              const vendorLabel = schema ? vendorLabelFor(schema, structured) : null;
              const vendorProfile =
                schema && vendorLabel
                  ? vendorProfileByKey.get(`${finding.templateItem.title}::${vendorKeyFor(vendorLabel)}`)
                  : undefined;
              const recalled =
                schema && vendorProfile
                  ? recallFields(
                      schema,
                      {
                        vendorLabel: vendorProfile.vendorLabel,
                        sourceBusinessName: vendorProfile.sourceBusinessName,
                        recordedAt: vendorProfile.updatedAt,
                        values: (vendorProfile.values ?? {}) as Record<string, string>,
                      },
                      structured,
                      (fieldKey, value) => {
                        const field = schema.fields.find((f) => f.key === fieldKey);
                        return field ? formatFieldValue(field, value) : value;
                      },
                    )
                  : [];
              const citableDocuments = finding.evidence
                .filter((e) => e.storageKey)
                .map((e) => ({ id: e.id, name: e.label ?? e.text ?? "document" }));
              // Advisory only — spec.md §2.3's pre-LOI/post-LOI distinction made visible. A
              // cooperative broker hands over documents earlier than the tidy model expects, so
              // this labels and never disables.
              const unavailable = unavailableReason(
                finding.templateItem.blockingDependency,
                audit.engagement.dealStage,
              );

              // Which card the last submission concerned, carried back by runForFinding. The
              // error banner above says WHAT was refused; without this the consultant still has to
              // work out WHICH of 24 findings it was about.
              const justFailed = Boolean(error) && failedFindingId === finding.id;
              const justSaved = !error && savedFindingId === finding.id;

              return (
                // Stays a `div.rounded-lg`: the browser suites address a finding card by exactly
                // that selector plus its title text.
                <div
                  key={finding.id}
                  id={findingAnchorId(finding.id)}
                  className={cn(
                    "relative overflow-hidden rounded-lg border bg-white shadow-xs scroll-mt-4",
                    justFailed ? "border-sev-red-border ring-2 ring-sev-red-border" : "border-ink-200",
                  )}
                >
                  <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", meta.rail)} />
                  <div className="py-3.5 pr-4 pl-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm leading-snug font-semibold text-ink-900">
                          {finding.templateItem.title}
                        </h3>
                        {finding.templateItem.description && (
                          <p className="mt-1 text-xs leading-relaxed text-ink-500">
                            {finding.templateItem.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              META_CHIP,
                              finding.templateItem.method === "AUTOMATED"
                                ? "border-accent-200 bg-accent-50 text-accent-800"
                                : "border-ink-200 bg-ink-50 text-ink-600",
                            )}
                          >
                            {finding.templateItem.method === "AUTOMATED" ? "Automated" : "Manual"}
                          </span>
                          <BlockingChip
                            dependency={finding.templateItem.blockingDependency}
                            reason={unavailable}
                          />
                          <EvidenceChip
                            expectation={finding.templateItem.evidenceExpectation}
                            satisfied={isEvidenceSatisfied(finding)}
                            rated={finding.severity !== null}
                          />
                        </div>
                        <FindingGuidance
                          itemTitle={finding.templateItem.title}
                          guidance={finding.templateItem.guidance}
                          severityGuidance={finding.templateItem.severityGuidance}
                          unavailable={unavailable}
                        />
                      </div>
                      {/* Rows written before severity and NOT_APPLICABLE were stopped from being
                          stored together still carry both. The roll-up excludes them, so showing the
                          dot would put a Red marker on an item the tier header counts as resolved. */}
                      {finding.severity && finding.status !== "NOT_APPLICABLE" && (
                        <SeverityBadge
                          severity={finding.severity}
                          size="sm"
                          label={finding.severity}
                          className="mt-0.5"
                        />
                      )}
                    </div>

                    {/* The fast-entry strip. One row, one Save, labelled through aria-label rather
                        than visible labels: this is the control a consultant hits 20+ times per
                        audit, and the option text and placeholder already name each field. */}
                    <form
                      key={`${finding.status}-${finding.severity}-${finding.note}-${JSON.stringify(structured)}`}
                      action={updateFindingAction}
                      className="mt-3.5 rounded-md border border-ink-200 bg-ink-50 p-2.5"
                    >
                      <input type="hidden" name="findingId" value={finding.id} />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_140px_minmax(0,1fr)_auto]">
                        <select
                          name="status"
                          aria-label="Status"
                          defaultValue={finding.status}
                          className={selectClass()}
                        >
                          {["NOT_STARTED", "IN_PROGRESS", "PASS", "FAIL", "NOT_APPLICABLE", "BLOCKED"].map((s) => (
                            <option key={s} value={s}>
                              {s.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                        <select
                          name="severity"
                          aria-label="Severity"
                          defaultValue={finding.severity ?? ""}
                          className={selectClass()}
                        >
                          <option value="">No rating</option>
                          <option value="GREEN">Green</option>
                          <option value="YELLOW">Yellow</option>
                          <option value="RED">Red</option>
                        </select>
                        <input
                          name="note"
                          // The placeholder is the only thing naming this control, and a
                          // placeholder is not an accessible name — 23 identical "Finding note"
                          // boxes on one page were indistinguishable to a screen reader and to
                          // voice control. The title disambiguates them; the visible text is
                          // untouched (the suites assert on the placeholder).
                          aria-label={`Finding note — ${finding.templateItem.title}`}
                          defaultValue={finding.note ?? ""}
                          placeholder="Finding note"
                          className={inputClass()}
                        />
                        <button type="submit" className={buttonClass("primary")}>
                          Save
                        </button>
                      </div>

                      {schema && <StructuredFields schema={schema} values={structured} />}
                    </form>

                    {/* The acknowledgement this page had none of: 24 saves, no confirmation of any
                        kind. Server-rendered so it works with no JS; FindingDraftKeeper hides it
                        after a few seconds so it does not become permanent furniture. */}
                    {justSaved && (
                      <p data-saved-marker className="cc-saved mt-1.5 text-[11px] font-medium text-sev-green">
                        Saved
                      </p>
                    )}

                    {vendorProfile && recalled.length > 0 && (
                      <VendorRecall
                        vendorLabel={vendorProfile.vendorLabel}
                        sourceBusinessName={vendorProfile.sourceBusinessName}
                        recordedAt={vendorProfile.updatedAt}
                        fields={recalled}
                      />
                    )}

                    {schema && (
                      <FieldSources
                        schema={schema}
                        citations={citations}
                        documents={citableDocuments}
                        citeAction={citeEvidenceAction}
                      />
                    )}

                    {/* Evidence is the secondary step, deliberately: findings entry defaults to fast
                        (spec.md §4), and a document that has not arrived must never read as a block
                        on recording what you already know. */}
                    <div className="mt-3 border-t border-ink-100 pt-3">
                      <div className={EYEBROW}>Evidence</div>
                      {finding.evidence.length > 0 && (
                        <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-md border border-ink-200">
                          {finding.evidence.map((e) => (
                            <li key={e.id} className="flex items-start justify-between gap-3 px-2.5 py-2 text-sm">
                              <div className="min-w-0">
                                <a
                                  href={`/api/evidence/${e.id}`}
                                  className="block truncate text-xs font-medium text-ink-800 underline hover:text-accent-700"
                                  title={e.text ?? undefined}
                                >
                                  {e.label ?? e.text ?? "document"}
                                </a>
                                <div className="mt-0.5 text-[11px] text-ink-500">
                                  {describeEvidence(e)}
                                </div>
                              </div>
                              {/* This control hard-deletes the stored object: unrecoverable, and
                                  the seller may not send the document again. It used to be the
                                  weakest-looking thing on the card — 45×16px of #98a1b3 (2.60:1,
                                  below AA) that only turned red once you were already hovering it.
                                  Now it reads as what it is, is big enough to hit on purpose
                                  (WCAG 2.5.8), and NAMES the file in its accessible name so
                                  "remove" from a screen reader or a voice command is never
                                  ambiguous between a card's several documents. */}
                              <form action={deleteEvidenceAction}>
                                <input type="hidden" name="evidenceId" value={e.id} />
                                <button
                                  type="submit"
                                  aria-label={`Remove ${e.label ?? e.text ?? "document"} — deletes the file permanently`}
                                  className={buttonClass("danger", "sm", "shrink-0")}
                                >
                                  Remove
                                </button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                      {/* States the consequence BEFORE the click, which is the part a consultant
                          cannot get back. A real two-step confirmation is the better answer and is
                          not here on purpose: b-findings-evidence row B7 clicks "Remove" once and
                          waits for the delete, so gating it behind a reveal would hang that row —
                          it needs the test changed in the same commit. */}
                      {finding.evidence.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-ink-500">
                          Removing a document deletes the stored file permanently.
                        </p>
                      )}
                      <form action={attachEvidenceAction} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="findingId" value={finding.id} />
                        {/* Same reason as the note input: 23 unnamed file pickers and 23 unnamed
                            label boxes, told apart only by where they sit on the page. */}
                        <input
                          type="file"
                          name="file"
                          accept={EVIDENCE_ACCEPT}
                          aria-label={`Attach a document — ${finding.templateItem.title}`}
                          className="min-w-0 max-w-full text-xs text-ink-500 file:mr-2 file:rounded-md file:border file:border-ink-300 file:bg-white file:px-2 file:py-1 file:text-xs file:font-medium file:text-ink-700 hover:file:bg-ink-100"
                        />
                        <input
                          name="label"
                          aria-label={`Document label — ${finding.templateItem.title}`}
                          placeholder="Label (optional) — e.g. Toast MSA, executed"
                          className={cn(DENSE_INPUT, "w-full max-w-full sm:w-64")}
                        />
                        <button type="submit" className={buttonClass("secondary", "sm")}>
                          Attach
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        );
      })}
    </div>
  );
}
