import Link from "next/link";
import { notFound } from "next/navigation";
import { Tier } from "@prisma/client";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import { runTierAAutomation, updateFinding, updateAuditOverride } from "@/lib/actions/audits";
import { generateReport } from "@/lib/actions/reports";
import { attachEvidence, deleteEvidence } from "@/lib/actions/evidence";
import { isContractItem } from "@/lib/audit/contractItem";

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

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string; auditId: string }>;
}) {
  const { id: engagementId, auditId } = await params;
  const { orgId } = await requireOrgSession();

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

  const org = await withOrgScope(orgId, (tx) =>
    tx.consultantOrg.findUniqueOrThrow({ where: { id: orgId }, select: { disclaimerAcknowledgedAt: true } }),
  );

  const rollup = computeSeverityRollup(audit.findings);
  const byTier: Record<Tier, typeof audit.findings> = { A: [], B: [], C: [] };
  for (const f of audit.findings) byTier[f.templateItem.tier].push(f);

  return (
    <div>
      <Link href={`/engagements/${engagementId}`} className="text-sm text-slate-500 hover:underline">
        ← {audit.engagement.businessName}
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">
          {audit.template.name} v{audit.template.version}
        </h1>
        <div className="flex items-center gap-2 text-sm">
          <span>Overall:</span>
          {rollup.overallCoverage.rated === 0 ? (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
              Not yet rated
            </span>
          ) : (
            <>
              <span className={`h-3 w-3 rounded-full ${SEVERITY_DOT[rollup.overall]}`} />
              <span className="font-medium">{rollup.overall}</span>
            </>
          )}
          <span className="text-xs text-slate-400">
            ({rollup.overallCoverage.rated}/{rollup.overallCoverage.total} rated)
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <form action={runTierAAutomation}>
          <input type="hidden" name="auditId" value={audit.id} />
          <button
            type="submit"
            disabled={!audit.engagement.primaryDomain}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run Tier A automated checks
          </button>
        </form>
        <form action={generateReport} className="flex items-center gap-2">
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
        <form action={updateAuditOverride} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr_auto]">
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
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  {r.generatedAt.toISOString().slice(0, 19).replace("T", " ")} —{" "}
                  {r.overallCoveredCount === 0 ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Not yet rated
                    </span>
                  ) : (
                    <span className="font-medium">{r.computedOverallSeverity}</span>
                  )}
                  <span className="text-xs text-slate-400">
                    ({r.overallCoveredCount}/{r.overallTotalCount} rated)
                  </span>
                </span>
                <a href={`/api/reports/${r.id}/pdf`} className="text-slate-600 underline hover:text-slate-900">
                  Download PDF
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(Object.keys(TIER_LABEL) as Tier[]).map((tier) => (
        <section key={tier} className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-900">{TIER_LABEL[tier]}</h2>
            {rollup.perTierCoverage[tier].rated === 0 ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                Not yet rated
              </span>
            ) : (
              <span className={`h-2.5 w-2.5 rounded-full ${SEVERITY_DOT[rollup.perTier[tier]]}`} />
            )}
            <span className="text-xs text-slate-400">
              ({rollup.perTierCoverage[tier].rated}/{rollup.perTierCoverage[tier].total} rated)
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {byTier[tier].map((finding) => {
              const contractFields = isContractItem(finding.templateItem.title);
              const structured = (finding.structuredData ?? {}) as {
                transferable?: string | null;
                penaltyAmount?: string | null;
                penaltyBasis?: string | null;
              };

              return (
                <div key={finding.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-slate-900">{finding.templateItem.title}</div>
                      {finding.templateItem.description && (
                        <div className="mt-0.5 text-xs text-slate-500">{finding.templateItem.description}</div>
                      )}
                      <div className="mt-1 text-xs text-slate-400">
                        {finding.templateItem.method === "AUTOMATED" ? "Automated" : "Manual"}
                      </div>
                    </div>
                    {finding.severity && (
                      <span className={`h-3 w-3 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`} />
                    )}
                  </div>

                  <form
                    key={`${finding.status}-${finding.severity}-${finding.note}-${JSON.stringify(structured)}`}
                    action={updateFinding}
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

                    {contractFields && (
                      <div className="col-span-full grid grid-cols-1 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-3">
                        <label className="text-xs text-slate-500">
                          Transferable to new owner
                          <select
                            name="transferable"
                            defaultValue={structured.transferable ?? ""}
                            className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
                          >
                            <option value="">Not recorded</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                            <option value="unclear">Unclear</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-500">
                          Early-termination penalty amount
                          <input
                            name="penaltyAmount"
                            defaultValue={structured.penaltyAmount ?? ""}
                            placeholder="e.g. $12,000 or 3 months' fees"
                            className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-500">
                          Penalty basis
                          <input
                            name="penaltyBasis"
                            defaultValue={structured.penaltyBasis ?? ""}
                            placeholder="e.g. flat fee, % of remaining term"
                            className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                          />
                        </label>
                      </div>
                    )}
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
                            <form action={deleteEvidence}>
                              <input type="hidden" name="evidenceId" value={e.id} />
                              <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                                Remove
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form action={attachEvidence} className="mt-2 flex items-center gap-2">
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
      ))}
    </div>
  );
}
