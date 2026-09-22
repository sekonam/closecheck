import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { recordMetric } from "@/lib/metrics/record";
import { objectExists } from "@/lib/storage/objectStore";
import { resolvePortalAccess } from "./access";
import { loadPortalBranding, type PortalBranding } from "./branding";

/**
 * Public, unauthenticated Client Portal view (spec.md §7) — a buyer with no CloseCheck account,
 * authorized by the token in the URL alone. Lives outside the (app) route group entirely, like
 * /login and /signup.
 *
 * resolvePortalAccess's RLS policies (prisma/migrations/20260918100100_portal_role) already refuse
 * to return a link that's missing, revoked, or expired — the null check below is genuinely "no such
 * link" in every one of those cases, and deliberately doesn't distinguish them in what's shown to
 * the visitor (telling an ex-buyer "this link was revoked" vs. "this link never existed" leaks more
 * than a report link's existence should).
 *
 * The page is chrome around the report, not a second rendering of it: the PDF is the deliverable
 * (spec.md §2 principle 1) and the portal must not become a divergent representation of the same
 * findings (consultant-ux-design skill, §7 constraints).
 */
export const metadata: Metadata = {
  title: "Shared due-diligence report",
  // A magic link is unguessable but not secret from a crawler that is handed one (a buyer pasting
  // it into a tool, a mail client prefetch). Nothing under /portal should ever enter an index.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

const DEFAULT_ACCENT = "#0f172a";

/** Same validation the report renderer applies: the brand color is interpolated into a style
 * attribute, so anything that is not a plain hex color falls back to the default. */
function safeAccent(hex: string | null | undefined): string {
  if (!hex) return DEFAULT_ACCENT;
  const trimmed = hex.trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed) ? trimmed : DEFAULT_ACCENT;
}

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Also what keeps this route dynamic. Without a headers() call Next may treat the page as
  // statically cacheable, and a buyer-facing magic-link page served from a shared cache would be
  // a far larger problem than the logging this reads.
  const requestHeaders = await headers();

  const access = await resolvePortalAccess(token, { log: true, kind: "PAGE", headers: requestHeaders });

  if (!access) notFound();

  // Telemetry (spec.md §11 report-usage signal). Via the app-role client's INSERT-only grant, not
  // the portal role — carries only ids, and failure never affects the buyer's view.
  void recordMetric("portal.viewed", { orgId: access.orgId, data: { reportId: access.reportId } });

  // Snapshot first: this report's own branding, as generated. The orgId is only consulted for
  // reports predating the snapshot columns (see loadPortalBranding).
  const branding = await loadPortalBranding(access.orgId, access.brandSnapshot);
  const accent = safeAccent(branding?.accentHex);

  if (!access.pdfStorageKey || !(await reportFileExists(access.pdfStorageKey))) {
    return (
      <PortalShell branding={branding} accent={accent}>
        <Unavailable />
      </PortalShell>
    );
  }

  const pdfUrl = `/portal/${encodeURIComponent(token)}/pdf`;

  return (
    <PortalShell branding={branding} accent={accent}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Technology due-diligence report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Read-only copy shared with you{branding ? ` by ${branding.orgName}` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Open in new tab
          </a>
          <a
            href={`${pdfUrl}?download=1`}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
            style={{ backgroundColor: accent }}
          >
            Download PDF
          </a>
        </div>
      </div>

      {/* A real URL in an iframe, not a base64 data: URI in an <embed>: the browser streams and
          caches it, and the mobile browsers that refuse to plugin-render data: PDFs can still hand
          it to their own viewer. Mobile Safari renders only the first page inside a frame, which is
          why the two links above are peers of the viewer rather than a fallback hidden below it. */}
      <iframe
        src={pdfUrl}
        title="Due-diligence report"
        className="w-full flex-1 rounded-lg border border-slate-200 bg-white"
        style={{ minHeight: "78vh" }}
      />

      <p className="mt-3 text-center text-xs text-slate-500">
        This link is scoped to one report and can be revoked at any time by the firm that shared it.
        If the report does not appear above, use “Download PDF”.
      </p>
    </PortalShell>
  );
}

/**
 * Does the stored PDF actually exist? A Report row can carry a pdfStorageKey whose file is gone —
 * a database restored onto a fresh volume, a file removed by hand — and the buyer is the one person
 * who can neither diagnose nor fix that. Checking here means they get the same "contact the firm"
 * explanation as the not-yet-generated case, instead of an empty viewer frame with two buttons that
 * both 404.
 *
 * Presence, not a read: pulling a multi-megabyte PDF into memory to decide whether to render a page
 * would be a real cost on every view. `objectExists` is a stat on local and a HEAD on S3.
 *
 * THIS USED TO RESOLVE THE PATH ITSELF — `stat(join(storageRoot(), key))` — with a comment
 * predicting that it would become a HEAD request when storage moved. It did, and the prediction is
 * why this was caught: under an S3 configuration `storageRoot()` still names a local directory, so
 * every stat would have missed, and every buyer on every live link would have been told the report
 * was unavailable while it sat readable in the bucket. Nothing would have looked broken.
 *
 * ONLY A DEFINITE ABSENCE COUNTS AS ABSENT. `objectExists` throws on anything indeterminate — a
 * permissions failure, a throttle, a dropped socket — rather than reporting false, and a throw here
 * means the report is shown. The two wrong answers are not symmetric: a viewer that fails to load
 * is a visible malfunction and the buyer knows something is wrong, while "the report isn't
 * available, contact the firm" is a confident false statement indistinguishable from the real case
 * — so the buyer has no reason to doubt it and the consultant may never hear. That is the same
 * failure as an appendix promising documents that had already been deleted.
 */
async function reportFileExists(key: string): Promise<boolean> {
  try {
    return await objectExists(key);
  } catch (err) {
    // Recorded, not swallowed: a storage backend that cannot answer is an operator problem, and
    // the buyer is the last person who should be the one to notice it.
    console.error("portal: could not determine whether the report PDF exists", { key, err });
    return true;
  }
}

/**
 * Whitelabel chrome (spec.md §2 principle 4, §6): the consultant's logo, name and accent frame the
 * report — this page is the consultant's deliverable reaching their client, and CloseCheck's own
 * branding has no place competing with it here. Without a brand kit it degrades to the firm's name,
 * and without branding at all to neutral chrome — never to CloseCheck's.
 */
function PortalShell({
  branding,
  accent,
  children,
}: {
  branding: PortalBranding | null;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white" style={{ borderBottomColor: accent, borderBottomWidth: 3 }}>
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3">
          {branding?.logoDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URI, not an optimizable remote asset
            <img
              src={branding.logoDataUri}
              alt={`${branding.orgName} logo`}
              className="h-8 w-auto object-contain"
            />
          ) : null}
          {/* Truncated rather than wrapped: a long firm name pushed the header to three lines at
              phone width, which is where a buyer forwarded a link is most likely to open it. */}
          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
            {branding?.orgName ?? "Due-diligence report"}
          </span>
          <span className="ml-auto shrink-0 text-xs text-slate-500">Read-only · confidential</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6">{children}</main>
    </div>
  );
}

/**
 * The link is live but the file behind it is not (PDF never finished generating, or the stored
 * object is gone — a database restored onto a fresh volume, a file removed by hand). The buyer is
 * the one person here who cannot fix it and did not choose this product, so this degrades to a
 * plain explanation pointing back at the firm, never an error page.
 */
function Unavailable() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Report not ready</h1>
      <p className="max-w-sm text-sm text-slate-500">
        This link is valid, but the report it points to isn&apos;t available yet. Please contact the
        firm that shared this link with you.
      </p>
    </div>
  );
}
