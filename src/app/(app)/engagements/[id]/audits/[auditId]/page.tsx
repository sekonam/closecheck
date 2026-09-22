import Link from "next/link";
import { notFound } from "next/navigation";
import { Tier } from "@prisma/client";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import { runTierAAutomation, updateFinding, updateAuditOverride, markAuditComplete, reopenAudit } from "@/lib/actions/audits";
import { generateReport } from "@/lib/actions/reports";
import { attachEvidence, deleteEvidence } from "@/lib/actions/evidence";
import { parseFieldSchema, readPersistedValues } from "@/lib/templates/fieldSchema";
import { StructuredFields } from "./StructuredFields";
import { BlockingChip, EvidenceChip, FindingGuidance } from "./FindingGuidance";
import { PortalAccessHistory } from "./PortalAccessHistory";
import { unavailableReason } from "@/lib/audit/blocking";
import { computeEvidenceCoverage, isEvidenceSatisfied } from "@/lib/reports/evidenceCoverage";
import { createPortalLink, revokePortalLink, emailPortalLink } from "@/lib/actions/portal";
import { runOrRedirect } from "@/lib/actions/errorRedirect";

const TIER_LABEL: Record<Tier, string> = {
  A: "Tier A — External (no seller cooperation needed)",
  B: "Tier B — Seller/broker-provided documents",
  C: "Tier C — Live access verification",
};

const SEVERITY_DOT: Record<string, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-500",
  RED: "bg-red-600",
};

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
  searchParams: Promise<{ error?: string }>;
}) {
  const { id: engagementId, auditId } = await params;
  const { error } = await searchParams;
  const { orgId } = await requireOrgSession();
  const backPath = `/engagements/${engagementId}/audits/${auditId}`;

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
    await runOrRedirect(() => updateFinding(formData), backPath);
  }
  async function attachEvidenceAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => attachEvidence(formData), backPath);
  }
  async function deleteEvidenceAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => deleteEvidence(formData), backPath);
  }

  const audit = await withOrgScope(orgId, (tx) =>
    tx.audit.findUnique({
      where: { id: auditId },
      include: {
        engagement: true,
        template: true,
        findings: {
          include: { templateItem: true, evidence: { orderBy: { createdAt: "desc" } } },
          orderBy: { templateItem: { sortOrder: "asc" } },
        },
      },
    }),
  );
  if (!audit || audit.engagementId !== engagementId) notFound();

  const reports = await withOrgScope(orgId, (tx) =>
    tx.report.findMany({ where: { auditId }, orderBy: { generatedAt: "desc" } }),
  );

  // Client Portal Links (spec.md §7) for these reports, with each link's access log (spec.md §8's
  // "who viewed/exported/shared a given Report and when," from the consultant's side — there's no
  // "who" for an anonymous buyer, just "when" and a hashed IP, so this list itself is the answer).
  const portalLinks = await withOrgScope(orgId, (tx) =>
    tx.clientPortalLink.findMany({
      where: { reportId: { in: reports.map((r) => r.id) } },
      include: { accessLog: { orderBy: { viewedAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    }),
  );
  const portalLinksByReport = new Map<string, typeof portalLinks>();
  for (const link of portalLinks) {
    const existing = portalLinksByReport.get(link.reportId) ?? [];
    existing.push(link);
    portalLinksByReport.set(link.reportId, existing);
  }

  const org = await withOrgScope(orgId, (tx) =>
    tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId }, select: { disclaimerAcknowledgedAt: true } }),
  );

  const rollup = computeSeverityRollup(audit.findings);
  const byTier: Record<Tier, typeof audit.findings> = { A: [], B: [], C: [] };
  for (const f of audit.findings) byTier[f.templateItem.tier].push(f);
  const overallStatus = coverageStatus(rollup.overallCoverage.rated, rollup.overallCoverage.total);
  // How much of the audit has evidence behind it, not just a rating on it. A Tier B item can be
  // marked Green with no contract attached and every field blank; without this the audit page
  // presents that identically to one backed by an executed agreement.
  const evidenceCoverage = computeEvidenceCoverage(audit.findings);

  return (
    <div>
      <Link href={`/engagements/${engagementId}`} className="text-sm text-slate-500 hover:underline">
        ← {audit.engagement.businessName}
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          {audit.template.name} v{audit.template.version}
          {audit.status === "COMPLETE" && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Complete
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2 text-sm">
          <span>Overall:</span>
          {overallStatus !== "rated" ? (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
              {overallStatus === "not-applicable" ? "Not applicable" : "Not yet rated"}
            </span>
          ) : (
            <>
              <span className={`h-3 w-3 rounded-full ${SEVERITY_DOT[rollup.overall]}`} />
              <span className="font-medium">{rollup.overall}</span>
            </>
          )}
          <span className="text-xs text-slate-400">
            ({rollup.overallCoverage.rated}/{rollup.overallCoverage.total} rated
            {evidenceCoverage.overall.expected > 0 &&
              ` · ${evidenceCoverage.overall.supported}/${evidenceCoverage.overall.expected} evidenced`}
            )
          </span>
        </div>
      </div>

      {evidenceCoverage.unsupportedRatedCount > 0 && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {evidenceCoverage.unsupportedRatedCount}{" "}
          {evidenceCoverage.unsupportedRatedCount === 1 ? "finding is" : "findings are"} rated with no
          document or attestation behind{" "}
          {evidenceCoverage.unsupportedRatedCount === 1 ? "it" : "them"}. They will still appear in
          the report — this is a prompt, not a block, since a seller who won&rsquo;t produce a
          document is itself a finding.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <form action={runTierAAutomationAction}>
          <input type="hidden" name="auditId" value={audit.id} />
          <button
            type="submit"
            disabled={!audit.engagement.primaryDomain}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run Tier A automated checks
          </button>
        </form>
        <form action={generateReportAction} className="flex items-center gap-2">
          <input type="hidden" name="auditId" value={audit.id} />
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" name="includeAppendix" />
            Include uploaded documents as an appendix
          </label>
          <button
            type="submit"
            disabled={!org.disclaimerAcknowledgedAt}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Generate report
          </button>
        </form>
        {audit.status === "COMPLETE" ? (
          <form action={reopenAuditAction}>
            <input type="hidden" name="auditId" value={audit.id} />
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Reopen audit
            </button>
          </form>
        ) : (
          <form action={markAuditCompleteAction}>
            <input type="hidden" name="auditId" value={audit.id} />
            <button
              type="submit"
              className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
            >
              Mark audit complete
            </button>
          </form>
        )}
        {!audit.engagement.primaryDomain && (
          <p className="self-center text-xs text-amber-600">
            Set a primary domain on the engagement to enable Tier A automation.
          </p>
        )}
        {!org.disclaimerAcknowledgedAt && (
          <p className="self-center text-xs text-amber-600">
            Review the report disclaimer on the{" "}
            <Link href="/settings" className="underline">
              Branding
            </Link>{" "}
            page to enable report generation.
          </p>
        )}
      </div>

      <div
        key={`${audit.overallRatingOverride}-${audit.overallRatingOverrideNote}`}
        className="mt-4 rounded-lg border border-slate-200 bg-white p-3"
      >
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Override computed rating
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          The computed rating above is always kept and shown — an override is added alongside it in
          the report, never in place of it (docs/spec.md §6).
        </p>
        <form action={updateAuditOverrideAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr_auto]">
          <input type="hidden" name="auditId" value={audit.id} />
          <select
            name="overallRatingOverride"
            defaultValue={audit.overallRatingOverride ?? ""}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">No override</option>
            <option value="GREEN">Green</option>
            <option value="YELLOW">Yellow</option>
            <option value="RED">Red</option>
          </select>
          <input
            name="overallRatingOverrideNote"
            defaultValue={audit.overallRatingOverrideNote ?? ""}
            placeholder="Why the override — required context for the report reader"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Save
          </button>
        </form>
      </div>

      {reports.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">Reports</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {reports.map((r) => {
              const links = portalLinksByReport.get(r.id) ?? [];
              return (
              <li key={r.id} className="border-b border-slate-100 py-2 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    {r.generatedAt.toISOString().slice(0, 19).replace("T", " ")} —{" "}
                    {coverageStatus(r.overallCoveredCount, r.overallTotalCount) !== "rated" ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {coverageStatus(r.overallCoveredCount, r.overallTotalCount) === "not-applicable"
                          ? "Not applicable"
                          : "Not yet rated"}
                      </span>
                    ) : (
                      <span className="font-medium">{r.computedOverallSeverity}</span>
                    )}
                    <span className="text-xs text-slate-400">
                      ({r.overallCoveredCount}/{r.overallTotalCount} rated)
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <a href={`/api/reports/${r.id}/pdf`} className="text-slate-600 underline hover:text-slate-900">
                      Download PDF
                    </a>
                    <form action={createPortalLinkAction}>
                      <input type="hidden" name="reportId" value={r.id} />
                      <button type="submit" className="text-slate-600 underline hover:text-slate-900">
                        Create client link
                      </button>
                    </form>
                  </div>
                </div>
                {links.length > 0 && (
                  <ul className="mt-2 space-y-2 pl-3 text-xs">
                    {links.map((link) => {
                      const isRevoked = Boolean(link.revokedAt);
                      const isExpired = link.expiresAt.getTime() < Date.now();
                      const isLive = !isRevoked && !isExpired;
                      return (
                        <li key={link.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                          <div className="flex items-center justify-between gap-2">
                            {isLive ? (
                              <a
                                href={`/portal/${link.token}`}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate text-slate-700 underline"
                              >
                                /portal/{link.token}
                              </a>
                            ) : (
                              <span className="truncate text-slate-400 line-through">/portal/{link.token}</span>
                            )}
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                                isLive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                              }`}
                            >
                              {isRevoked ? "Revoked" : isExpired ? "Expired" : "Live"}
                            </span>
                            {isLive && (
                              <form action={revokePortalLinkAction}>
                                <input type="hidden" name="linkId" value={link.id} />
                                <button type="submit" className="shrink-0 text-slate-500 underline hover:text-slate-700">
                                  Revoke
                                </button>
                              </form>
                            )}
                          </div>
                          <PortalAccessHistory
                            createdAt={link.createdAt}
                            expiresAt={link.expiresAt}
                            revokedAt={link.revokedAt}
                            accessLog={link.accessLog}
                          />
                          {isLive && (
                            <form action={emailPortalLinkAction} className="mt-1.5 flex items-center gap-2">
                              <input type="hidden" name="linkId" value={link.id} />
                              <input
                                name="recipientEmail"
                                type="email"
                                required
                                placeholder="buyer@example.com"
                                className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                              />
                              <button
                                type="submit"
                                className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50"
                              >
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
        </div>
      )}

      {(Object.keys(TIER_LABEL) as Tier[]).map((tier) => {
        const tierStatus = coverageStatus(rollup.perTierCoverage[tier].rated, rollup.perTierCoverage[tier].total);
        return (
        <section key={tier} className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-900">{TIER_LABEL[tier]}</h2>
            {tierStatus !== "rated" ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                {tierStatus === "not-applicable" ? "Not applicable" : "Not yet rated"}
              </span>
            ) : (
              <span className={`h-2.5 w-2.5 rounded-full ${SEVERITY_DOT[rollup.perTier[tier]]}`} />
            )}
            <span className="text-xs text-slate-400">
              ({rollup.perTierCoverage[tier].rated}/{rollup.perTierCoverage[tier].total} rated
              {evidenceCoverage.perTier[tier].expected > 0 &&
                ` · ${evidenceCoverage.perTier[tier].supported}/${evidenceCoverage.perTier[tier].expected} evidenced`}
              )
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
              // Advisory only — spec.md §2.3's pre-LOI/post-LOI distinction made visible. A
              // cooperative broker hands over documents earlier than the tidy model expects, so
              // this labels and never disables.
              const unavailable = unavailableReason(
                finding.templateItem.blockingDependency,
                audit.engagement.dealStage,
              );

              return (
                <div key={finding.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-slate-900">{finding.templateItem.title}</div>
                      {finding.templateItem.description && (
                        <div className="mt-0.5 text-xs text-slate-500">{finding.templateItem.description}</div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
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
                        guidance={finding.templateItem.guidance}
                        severityGuidance={finding.templateItem.severityGuidance}
                        unavailable={unavailable}
                      />
                    </div>
                    {/* Rows written before severity and NOT_APPLICABLE were stopped from being
                        stored together still carry both. The roll-up excludes them, so showing the
                        dot would put a Red marker on an item the tier header counts as resolved. */}
                    {finding.severity && finding.status !== "NOT_APPLICABLE" && (
                      <span className={`h-3 w-3 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`} />
                    )}
                  </div>

                  <form
                    key={`${finding.status}-${finding.severity}-${finding.note}-${JSON.stringify(structured)}`}
                    action={updateFindingAction}
                    className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[140px_140px_1fr_auto]"
                  >
                    <input type="hidden" name="findingId" value={finding.id} />
                    <select
                      name="status"
                      defaultValue={finding.status}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {["NOT_STARTED", "IN_PROGRESS", "PASS", "FAIL", "NOT_APPLICABLE", "BLOCKED"].map((s) => (
                        <option key={s} value={s}>
                          {s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <select
                      name="severity"
                      defaultValue={finding.severity ?? ""}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">No rating</option>
                      <option value="GREEN">Green</option>
                      <option value="YELLOW">Yellow</option>
                      <option value="RED">Red</option>
                    </select>
                    <input
                      name="note"
                      defaultValue={finding.note ?? ""}
                      placeholder="Finding note"
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Save
                    </button>

                    {schema && <StructuredFields schema={schema} values={structured} />}

                  </form>

                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Evidence</div>
                    {finding.evidence.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {finding.evidence.map((e) => (
                          <li key={e.id} className="flex items-center justify-between text-sm">
                            <a
                              href={`/api/evidence/${e.id}`}
                              className="text-slate-600 underline hover:text-slate-900"
                            >
                              {e.text ?? "document"}
                            </a>
                            <form action={deleteEvidenceAction}>
                              <input type="hidden" name="evidenceId" value={e.id} />
                              <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                                Remove
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form action={attachEvidenceAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="findingId" value={finding.id} />
                      <input type="file" name="file" className="text-xs" />
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Attach
                      </button>
                    </form>
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
