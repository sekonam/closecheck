import { Severity, Tier } from "@prisma/client";
import { computeSeverityRollup, type FindingForRollup } from "./rollup";

export interface ReportFinding extends FindingForRollup {
  id: string;
  note: string | null;
  status: string;
  structuredData?: unknown;
  evidenceCount?: number;
  templateItem: { tier: Tier; title: string; description: string | null };
}

export interface ReportData {
  businessName: string;
  templateName: string;
  generatedAt: Date;
  org: { name: string; brandColorHex: string | null; brandLogoUrl: string | null };
  findings: ReportFinding[];
  overallRatingOverride?: Severity | null;
  overallRatingOverrideNote?: string | null;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  [Severity.GREEN]: "Green",
  [Severity.YELLOW]: "Yellow",
  [Severity.RED]: "Red",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  [Severity.GREEN]: "#15803d",
  [Severity.YELLOW]: "#b45309",
  [Severity.RED]: "#b91c1c",
};

const TIER_LABEL: Record<Tier, string> = {
  A: "Tier A — External (no seller cooperation needed)",
  B: "Tier B — Seller/broker-provided documents",
  C: "Tier C — Live access verification",
};

function badge(severity: Severity): string {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:${SEVERITY_COLOR[severity]}">${SEVERITY_LABEL[severity]}</span>`;
}

/**
 * Renders the Report to a self-contained HTML string — the same rendering used for the on-screen
 * preview and, via src/lib/reports/pdf.ts, the PDF export. Deliberately does not import Tailwind's
 * runtime (the PDF pipeline renders this in an isolated Chromium page with no build step attached);
 * inline styles only, per docs/spec.md §6.
 *
 * Whitelabel (spec.md §6): the org's brand color drives the accent throughout; CloseCheck's own
 * branding is limited to a single small footer line, never competing with the consultant's own
 * brand kit (.claude/skills/consultant-ux-design/SKILL.md).
 */
export function renderReportHtml(data: ReportData): string {
  const rollup = computeSeverityRollup(data.findings);
  const accent = data.org.brandColorHex ?? "#0f172a";
  const byTier: Record<Tier, ReportFinding[]> = { A: [], B: [], C: [] };
  for (const f of data.findings) byTier[f.templateItem.tier].push(f);

  const overrideBlock =
    data.overallRatingOverride && data.overallRatingOverride !== rollup.overall
      ? `<div style="margin-top:8px;padding:10px 14px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font-size:13px">
          <strong>Consultant override:</strong> ${badge(data.overallRatingOverride)}
          <span style="color:#475569"> (computed rating shown above is retained, not replaced — spec.md §6)</span>
          ${data.overallRatingOverrideNote ? `<div style="margin-top:4px;color:#334155">${escapeHtml(data.overallRatingOverrideNote)}</div>` : ""}
        </div>`
      : "";

  const tierSections = (Object.keys(TIER_LABEL) as Tier[])
    .map((tier) => {
      const items = byTier[tier];
      if (items.length === 0) return "";
      const rows = items
        .map((f) => {
          const structured = (f.structuredData ?? null) as
            | { transferable?: string | null; penaltyAmount?: string | null; penaltyBasis?: string | null }
            | null;
          const structuredParts = structured
            ? [
                structured.transferable ? `Transferable: ${escapeHtml(structured.transferable)}` : null,
                structured.penaltyAmount ? `Penalty: ${escapeHtml(structured.penaltyAmount)}` : null,
                structured.penaltyBasis ? `Basis: ${escapeHtml(structured.penaltyBasis)}` : null,
              ].filter((v): v is string => Boolean(v))
            : [];

          return `
        <tr style="border-bottom:1px solid #e2e8f0">
          <td style="padding:8px 12px;vertical-align:top;width:70%">
            <div style="font-weight:600">${escapeHtml(f.templateItem.title)}</div>
            ${f.templateItem.description ? `<div style="color:#64748b;font-size:13px;margin-top:2px">${escapeHtml(f.templateItem.description)}</div>` : ""}
            ${f.note ? `<div style="margin-top:6px;font-size:13px;color:#334155"><em>Finding:</em> ${escapeHtml(f.note)}</div>` : ""}
            ${structuredParts.length > 0 ? `<div style="margin-top:4px;font-size:12px;color:#475569">${structuredParts.join(" · ")}</div>` : ""}
            ${f.evidenceCount ? `<div style="margin-top:4px;font-size:12px;color:#0369a1">${f.evidenceCount} document${f.evidenceCount === 1 ? "" : "s"} attached</div>` : ""}
          </td>
          <td style="padding:8px 12px;text-align:right;vertical-align:top">${f.severity ? badge(f.severity) : '<span style="color:#94a3b8;font-size:12px">not rated</span>'}</td>
        </tr>`;
        })
        .join("");

      return `
      <section style="margin-top:28px">
        <h3 style="display:flex;align-items:center;gap:10px;font-size:16px;margin:0 0 10px 0">
          ${TIER_LABEL[tier]} ${badge(rollup.perTier[tier])}
        </h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
          ${rows}
        </table>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>CloseCheck Report — ${escapeHtml(data.businessName)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#0f172a; margin:0; padding:40px; max-width:800px">
  <header style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${accent};padding-bottom:16px">
    <div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b">Technology Due-Diligence Report</div>
      <h1 style="margin:4px 0 0 0;font-size:24px">${escapeHtml(data.businessName)}</h1>
      <div style="color:#64748b;font-size:13px;margin-top:4px">Template: ${escapeHtml(data.templateName)} · Generated ${data.generatedAt.toISOString().slice(0, 10)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:700;font-size:16px">${escapeHtml(data.org.name)}</div>
    </div>
  </header>

  <section style="margin-top:24px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">
    <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Executive summary</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
      <span style="font-size:20px;font-weight:700">Overall</span>
      ${badge(rollup.overall)}
    </div>
    ${overrideBlock}
    <div style="display:flex;gap:20px;margin-top:12px">
      ${(Object.keys(TIER_LABEL) as Tier[])
        .map((tier) => `<div style="font-size:13px">${tier === "A" ? "Tier A" : tier === "B" ? "Tier B" : "Tier C"}: ${badge(rollup.perTier[tier])}</div>`)
        .join("")}
    </div>
  </section>

  ${tierSections}

  <footer style="margin-top:36px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
    <p>This report reflects information available as of the date generated above. It is not a substitute for legal, financial, or tax due diligence. Findings are based on the tier methodology described to the client separately; Tier C findings are consultant-attested observations, not automated verifications.</p>
    <p>Prepared using CloseCheck.</p>
  </footer>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
