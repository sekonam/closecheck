import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSession } from "@/lib/auth/session";
import { withOrgScope } from "@/lib/db/scoped";
import { prisma } from "@/lib/db/client";
import { createAudit } from "@/lib/actions/audits";
import { updateEngagement } from "@/lib/actions/engagements";
import { runOrRedirect } from "@/lib/actions/errorRedirect";
import { computeSeverityRollup } from "@/lib/reports/rollup";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Meter,
  PageHeader,
  SeverityBadge,
  cn,
  inputClass,
  selectClass,
} from "@/components/ui";

const DEAL_STAGES = ["PRE_LOI", "POST_LOI", "CLOSING", "CLOSED", "DEAD"] as const;

/**
 * The consultant's spelling of each stage, kept identical to the list page's map so the same deal
 * does not change name between the two screens. Duplicated for the same reason TERMINAL_STAGES
 * below is: both pages are page modules, and a shared vocabulary needs its own module to live in.
 *
 * This header used to render `engagement.dealStage` straight from the database, so the chip read
 * `PRE_LOI` — a storage identifier, shown to the customer, one line above a select spelling the
 * same value differently again.
 */
const DEAL_STAGE_LABEL: Record<string, string> = {
  PRE_LOI: "Pre-LOI",
  POST_LOI: "Post-LOI",
  CLOSING: "Closing",
  CLOSED: "Closed",
  DEAD: "Dead",
};

/** Terminal stages read as muted/finished work, active ones as live. See the list page for why. */
const TERMINAL_STAGES = new Set<string>(["CLOSED", "DEAD"]);

/**
 * Same three-way split as the audit page's `coverageStatus`: an all-NOT_APPLICABLE audit (total 0,
 * because computeSeverityRollup drops those from the denominator) is RESOLVED work, not pending
 * work, so it must not read as "not yet rated". Duplicated rather than shared because the audit
 * page's copy is page-local; if a third surface needs it, it belongs in @/lib/reports/rollup.
 */
function coverageStatus(rated: number, total: number): "not-applicable" | "not-yet-rated" | "rated" {
  if (total === 0) return "not-applicable";
  if (rated === 0) return "not-yet-rated";
  return "rated";
}

export default async function EngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { orgId } = await requireOrgSession();
  const backPath = `/engagements/${id}`;

  async function updateEngagementAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => updateEngagement(formData), backPath);
  }
  async function createAuditAction(formData: FormData) {
    "use server";
    await runOrRedirect(() => createAudit(formData), backPath);
  }

  // The audits' findings ride along with the audits rather than being counted per row: Prisma loads
  // a nested relation in one batched query keyed by parent id, so the audit list costs the same
  // whether the engagement has one audit or ten. Only the three fields computeSeverityRollup reads
  // are selected — notes and structured data never reach this page.
  const engagement = await withOrgScope(orgId, (tx) =>
    tx.engagement.findUnique({
      where: { id },
      include: {
        audits: {
          include: {
            template: true,
            findings: {
              select: { severity: true, status: true, templateItem: { select: { tier: true } } },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
  );
  if (!engagement) notFound();

  // Shared, non-tenant content (spec.md §5) — read directly.
  const activeTemplates = await prisma.template.findMany({ where: { isActive: true } });

  const terminalStage = TERMINAL_STAGES.has(engagement.dealStage);

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link href="/engagements" className="hover:text-ink-700 hover:underline">
            ← Engagements
          </Link>
        }
        title={engagement.businessName}
        description={engagement.primaryDomain ?? "No primary domain set"}
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
              terminalStage
                ? "border-ink-200 bg-ink-50 text-ink-500"
                : "border-accent-200 bg-accent-50 text-accent-700",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                terminalStage ? "border border-ink-400" : "bg-accent-500",
              )}
            />
            {DEAL_STAGE_LABEL[engagement.dealStage]}
          </span>
        }
      />

      {error && (
        <Callout tone="error" className="mb-6">
          {error}
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* The key is load-bearing: it remounts the form after a save so the uncontrolled inputs
            pick up the new defaultValues instead of holding the pre-save ones. */}
        <Card
          key={`${engagement.businessName}-${engagement.primaryDomain}-${engagement.dealStage}-${engagement.documentPurgeAt?.toISOString()}`}
          className="lg:col-span-2"
        >
          <CardHeader title="Edit engagement" />
          <CardBody>
            <form action={updateEngagementAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="engagementId" value={engagement.id} />
              <Field label="Business name" htmlFor="businessName">
                <input
                  id="businessName"
                  name="businessName"
                  defaultValue={engagement.businessName}
                  required
                  className={inputClass()}
                />
              </Field>
              <Field label="Primary domain (for Tier A checks)" htmlFor="primaryDomain">
                <input
                  id="primaryDomain"
                  name="primaryDomain"
                  defaultValue={engagement.primaryDomain ?? ""}
                  placeholder="example-restaurant.com"
                  className={inputClass()}
                />
              </Field>
              <Field label="Deal stage" htmlFor="dealStage">
                <select
                  id="dealStage"
                  name="dealStage"
                  defaultValue={engagement.dealStage}
                  className={selectClass()}
                >
                  {DEAL_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", "-")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Purge uploaded documents on/after"
                htmlFor="documentPurgeAt"
                hint="Blank = no purge scheduled. Applied by `npm run db:purge-expired-documents`, not automatically."
              >
                <input
                  id="documentPurgeAt"
                  name="documentPurgeAt"
                  type="date"
                  defaultValue={engagement.documentPurgeAt?.toISOString().slice(0, 10) ?? ""}
                  className={inputClass()}
                />
              </Field>
              <div className="flex sm:col-span-2">
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader title="Start a new audit" />
          <CardBody>
            <form action={createAuditAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="engagementId" value={engagement.id} />
              <Field label="Template" htmlFor="templateSlug" className="flex-1">
                <select id="templateSlug" name="templateSlug" className={selectClass()}>
                  {activeTemplates.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name} (v{t.version})
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit">Start audit</Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Audits" />
        <ul className="divide-y divide-ink-100">
          {engagement.audits.length === 0 && (
            <li>
              <EmptyState title="No audits started yet." />
            </li>
          )}
          {engagement.audits.map((a) => {
            // One pass over the findings already loaded above — no query per row. Run through
            // computeSeverityRollup rather than counted here so this row and the audit's own page
            // cannot disagree about what "rated" means (NOT_APPLICABLE excluded) or about the
            // worst-item tier rule (spec.md §6).
            const rollup = computeSeverityRollup(a.findings);
            const coverage = rollup.overallCoverage;
            const status = coverageStatus(coverage.rated, coverage.total);
            return (
              <li key={a.id}>
                <Link
                  href={`/engagements/${engagement.id}/audits/${a.id}`}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:-outline-offset-2"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900 group-hover:text-accent-700 group-focus-visible:text-accent-700">
                      {a.template.name} v{a.template.version}
                    </span>
                    {/* Where the consultant left off, so coming back to a deal does not mean
                        scrolling the whole audit to find out. Inside the flexible column, never as
                        its own fixed track: the row has to survive 400px next to the status badge. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {status === "rated" ? (
                        <SeverityBadge severity={rollup.overall} label={rollup.overall} size="sm" />
                      ) : (
                        <SeverityBadge
                          severity={null}
                          label={status === "not-applicable" ? "Not applicable" : "Not yet rated"}
                          size="sm"
                        />
                      )}
                      <span className="text-xs text-ink-500">
                        {coverage.rated}/{coverage.total} rated
                      </span>
                      <Meter
                        value={coverage.rated}
                        total={coverage.total}
                        className="w-full max-w-[12rem]"
                      />
                    </div>
                  </div>
                  <Badge tone="outline">{a.status}</Badge>
                  {/* Same reasoning as the engagements list's chevron: decorative, but the only
                      standing cue that the row is a link, and ink-300 on white was 1.61:1. */}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-ink-400 transition-colors group-hover:text-ink-700 group-focus-visible:text-ink-700"
                  >
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
