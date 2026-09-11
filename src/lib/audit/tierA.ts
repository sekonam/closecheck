import { FindingStatus, Severity } from "@prisma/client";
import { lookupWhois } from "@/lib/checks/whois";
import { fingerprintDns } from "@/lib/checks/dns";
import { fingerprintSsl } from "@/lib/checks/ssl";
import { fingerprintCms } from "@/lib/checks/cms";

export interface TierAResult {
  status: FindingStatus;
  severity: Severity;
  note: string;
  structuredData: Record<string, unknown>;
}

/**
 * Automation keys here must match `TemplateItem.automationKey` values seeded in prisma/seed.ts —
 * see docs/spec.md §4's Tier A table for what each item is and why it's automatable. Adding a new
 * automated Tier A item means adding both a case here and a seeded TemplateItem row; see
 * .claude/skills/audit-methodology/SKILL.md before doing either.
 *
 * These are the two named risk areas from docs/research/build.md (RLS correctness, and — separately
 * — PDF fidelity): this module is not one of them, but it IS the other place a wrong severity
 * silently costs a consultant's credibility, so keep the thresholds conservative and the notes
 * explicit about what was actually observed, not an inferred conclusion the consultant didn't make.
 */
function daysUntil(dateString: string | null): number | null {
  if (!dateString) return null;
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((parsed.getTime() - Date.now()) / 86_400_000);
}

async function runDomainWhois(domain: string): Promise<TierAResult> {
  const result = await lookupWhois(domain);
  const structuredData = { ...result };

  if (result.error) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `WHOIS lookup did not complete automatically (${result.error}). Verify registrar and expiry manually.`,
      structuredData,
    };
  }

  const expiryDays = daysUntil(result.expiryDate);
  if (expiryDays === null) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `WHOIS returned data but no parseable expiry date. Registrar: ${result.registrar ?? "unknown"}. Verify manually.`,
      structuredData,
    };
  }

  if (expiryDays < 30) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `Domain expires in ${expiryDays} day(s) (${result.expiryDate}). Registrar: ${result.registrar ?? "unknown"}. Confirm renewal/transfer plan before close.`,
      structuredData,
    };
  }
  if (expiryDays < 90) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Domain expires in ${expiryDays} day(s) (${result.expiryDate}). Registrar: ${result.registrar ?? "unknown"}. Worth confirming renewal responsibility post-close.`,
      structuredData,
    };
  }
  return {
    status: FindingStatus.PASS,
    severity: Severity.GREEN,
    note: `Registrar: ${result.registrar ?? "unknown"}. Expires ${result.expiryDate} (${expiryDays} days out).`,
    structuredData,
  };
}

async function runDnsFingerprint(domain: string): Promise<TierAResult> {
  const result = await fingerprintDns(domain);
  const structuredData = { ...result };

  if (result.error || result.nameservers.length === 0) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Could not resolve DNS for ${domain} (${result.error ?? "no nameservers returned"}). Verify the domain is live.`,
      structuredData,
    };
  }

  return {
    status: FindingStatus.PASS,
    severity: Severity.GREEN,
    note: `Nameservers: ${result.nameservers.join(", ")}${result.likelyProvider ? ` (likely ${result.likelyProvider})` : ""}. A records: ${result.aRecords.join(", ") || "none"}.`,
    structuredData,
  };
}

async function runSslCheck(domain: string): Promise<TierAResult> {
  const result = await fingerprintSsl(domain);
  const structuredData = { ...result };

  if (!result.valid) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `Certificate check failed for ${domain}: ${result.error ?? "not trusted"}.`,
      structuredData,
    };
  }

  if (result.daysUntilExpiry !== null && result.daysUntilExpiry < 14) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `Certificate expires in ${result.daysUntilExpiry} day(s) (${result.validTo}). Issuer: ${result.issuer ?? "unknown"}.`,
      structuredData,
    };
  }
  if (result.daysUntilExpiry !== null && result.daysUntilExpiry < 30) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Certificate expires in ${result.daysUntilExpiry} day(s) (${result.validTo}). Issuer: ${result.issuer ?? "unknown"}.`,
      structuredData,
    };
  }

  return {
    status: FindingStatus.PASS,
    severity: Severity.GREEN,
    note: `Valid certificate from ${result.issuer ?? "unknown issuer"}, expires ${result.validTo}.`,
    structuredData,
  };
}

async function runCmsFingerprint(domain: string): Promise<TierAResult> {
  const result = await fingerprintCms(`https://${domain}`);
  const structuredData = { ...result };

  if (result.error) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Could not fetch https://${domain} (${result.error}). Verify the site is reachable and check manually.`,
      structuredData,
    };
  }

  if (!result.cms) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `No known CMS/platform signature detected. May be a custom build or client-rendered site — verify manually.`,
      structuredData,
    };
  }

  // Deliberately not scoring a severity from version alone (docs/idea.md's evidentiary bar,
  // .claude/skills/audit-methodology/SKILL.md): a bare version string is not evidence of a known
  // vulnerability without checking it against something. Flag for manual review instead of guessing.
  return {
    status: FindingStatus.IN_PROGRESS,
    severity: Severity.YELLOW,
    note: `Detected ${result.cms}${result.version ? ` (version signal: ${result.version})` : ""}. Confirm patch status manually — CloseCheck does not assert vulnerability status from a version string alone.`,
    structuredData,
  };
}

const RUNNERS: Record<string, (domain: string) => Promise<TierAResult>> = {
  domain_whois: runDomainWhois,
  dns_hosting_fingerprint: runDnsFingerprint,
  ssl_cert: runSslCheck,
  cms_fingerprint: runCmsFingerprint,
};

export function isAutomatable(automationKey: string | null): boolean {
  return !!automationKey && automationKey in RUNNERS;
}

export async function runTierACheck(automationKey: string, domain: string): Promise<TierAResult> {
  const runner = RUNNERS[automationKey];
  if (!runner) {
    throw new Error(`No Tier A runner registered for automationKey "${automationKey}"`);
  }
  return runner(domain);
}
