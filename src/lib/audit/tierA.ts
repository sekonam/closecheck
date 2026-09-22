import { FindingStatus, Severity } from "@prisma/client";
import { lookupWhois } from "@/lib/checks/whois";
import { fingerprintDns } from "@/lib/checks/dns";
import { fingerprintSsl } from "@/lib/checks/ssl";
import { fingerprintCms } from "@/lib/checks/cms";
import { checkEmailAuth } from "@/lib/checks/emailAuth";
import { fingerprintMailProvider } from "@/lib/checks/mx";
import { checkHttpsHygiene } from "@/lib/checks/httpsHygiene";

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

/**
 * EPP status codes that stop a transfer outright, or say the registration is in trouble.
 *
 * Keyed on a normalised form because the wire format varies: RDAP returns spaced lowercase
 * ("server transfer prohibited", verified against live registry responses), legacy WHOIS returns
 * camelCase ("serverTransferProhibited"). Matching either spelling literally would silently miss
 * half the cases — and a status check that quietly matches nothing is worse than none, because it
 * reads as "checked, nothing found".
 */
const BLOCKING_DOMAIN_STATUSES: Record<string, string> = {
  pendingdelete: "the registration is being deleted",
  redemptionperiod: "the registration has expired and is in the redemption grace period",
  pendingtransfer: "a transfer to another registrar is already in progress",
  serverhold: "the registry has removed the domain from the zone — it will not resolve",
  clienthold: "the registrar has removed the domain from the zone — it will not resolve",
};

/**
 * Statuses that complicate a transfer without blocking it.
 *
 * A registry lock is deliberate protection on a valuable name, not a defect — but it has to be
 * lifted before the domain can move, and that is a step with a lead time the buyer should know
 * about. `clientTransferProhibited` is deliberately NOT here: it is the ordinary registrar lock
 * that sits on most domains by default, and flagging it would fire on nearly every audit, which
 * is how a check gets ignored.
 */
const TRANSFER_FRICTION_STATUSES: Record<string, string> = {
  servertransferprohibited: "the registry, not the registrar, is blocking transfers — it must be lifted before the domain can move",
  serverdeleteprohibited: "the registry has locked the registration against deletion",
  serverupdateprohibited: "the registry has locked the registration against updates",
};

/** "server transfer prohibited", "serverTransferProhibited" and "SERVER_TRANSFER_PROHIBITED" all
 * name the same EPP status; registries disagree about the spelling, so compare on this. */
function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * ICANN's Transfer Policy locks a domain against transfer for 60 days after a change of
 * registrant. A registration that changed hands recently therefore cannot change hands again
 * inside that window, which can strand it past a closing date — so this is a finding to raise
 * before the date is set, not after.
 *
 * Correct as of this audit and date-sensitive: the policy revision removing the lock was adopted
 * on 2026-06-07 (Resolution 2026.06.07.04) with no effective date published. Re-verify.
 */
const TRANSFER_LOCK_DAYS = 60;

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null;
  const parsed = Date.parse(dateString);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

function matchStatuses(statuses: string[], table: Record<string, string>): string[] {
  return statuses
    .map((status) => ({ status, meaning: table[normalizeStatus(status)] }))
    .filter((entry): entry is { status: string; meaning: string } => Boolean(entry.meaning))
    .map((entry) => `Status ${entry.status}: ${entry.meaning}.`);
}

/** Observations that matter to a buyer regardless of how the expiry date reads. */
function domainTransferNotes(result: Awaited<ReturnType<typeof lookupWhois>>): string[] {
  const notes: string[] = [];

  const sinceTransfer = daysSince(result.lastTransferDate);
  if (sinceTransfer !== null && sinceTransfer < TRANSFER_LOCK_DAYS) {
    notes.push(
      `Registration last changed hands ${sinceTransfer} day(s) ago (${result.lastTransferDate}); ` +
        `ICANN's Transfer Policy locks it against transfer for ${TRANSFER_LOCK_DAYS} days, so it ` +
        `cannot move again for roughly ${TRANSFER_LOCK_DAYS - sinceTransfer} more day(s). ` +
        "Check this against the expected closing date.",
    );
  }

  notes.push(...matchStatuses(result.statuses, BLOCKING_DOMAIN_STATUSES));
  notes.push(...matchStatuses(result.statuses, TRANSFER_FRICTION_STATUSES));
  return notes;
}

async function runDomainWhois(domain: string): Promise<TierAResult> {
  const result = await lookupWhois(domain);
  const structuredData = { ...result };
  const transferNotes = domainTransferNotes(result);
  const suffix = transferNotes.length > 0 ? ` ${transferNotes.join(" ")}` : "";
  // A status that stops a transfer outright is a Red on its own terms — the expiry date can read
  // perfectly while the domain cannot actually be handed over.
  const blockedNow = result.statuses.some(
    (status) => BLOCKING_DOMAIN_STATUSES[normalizeStatus(status)] !== undefined,
  );

  if (result.error) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Registration lookup did not complete automatically (${result.error}). Verify registrar, expiry and transfer status manually.`,
      structuredData,
    };
  }

  if (blockedNow) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note:
        `The registration is in a state that blocks or complicates transfer. Registrar: ` +
        `${result.registrar ?? "unknown"}.${suffix}`,
      structuredData,
    };
  }

  const expiryDays = daysUntil(result.expiryDate);
  if (expiryDays === null) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Registration data returned with no parseable expiry date. Registrar: ${result.registrar ?? "unknown"}. Verify manually.${suffix}`,
      structuredData,
    };
  }

  // 30/90 days is this firm's stated basis, derived from a domain needing to survive the close
  // plus a reasonable transition window — not an industry standard, because none is published.
  if (expiryDays < 30) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `Domain expires in ${expiryDays} day(s) (${result.expiryDate}). Registrar: ${result.registrar ?? "unknown"}. Confirm renewal and transfer plan before close.${suffix}`,
      structuredData,
    };
  }
  if (expiryDays < 90 || transferNotes.length > 0) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note:
        (expiryDays < 90
          ? `Domain expires in ${expiryDays} day(s) (${result.expiryDate}). Registrar: ${result.registrar ?? "unknown"}. Confirm who is responsible for renewal post-close.`
          : `Registrar: ${result.registrar ?? "unknown"}. Expires ${result.expiryDate} (${expiryDays} days out).`) + suffix,
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

async function runEmailAuthPosture(domain: string): Promise<TierAResult> {
  const result = await checkEmailAuth(domain);
  const structuredData = { ...result };

  if (result.error) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Email authentication lookup did not complete (${result.error}). Verify SPF/DMARC records manually.`,
      structuredData,
    };
  }

  // DKIM is deliberately note-only, never a severity input — a not-found probe result is not
  // evidence of absence (docs/spec.md §4's DKIM note: selectors can't be enumerated from public DNS).
  const dkimNote =
    result.dkimSelectorsFound.length > 0
      ? `DKIM record found at selector(s): ${result.dkimSelectorsFound.join(", ")}.`
      : "No DKIM record found at common selectors — not evidence of absence; the provider may use a custom selector.";

  if (!result.hasMx) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: result.nullMx
        ? `${domain} publishes a null MX (RFC 7505) — it explicitly does not receive email. Confirm which domain carries the business's email and re-check there.`
        : `${domain} has no MX records — this domain does not receive email. Confirm which domain carries the business's email and re-check there.`,
      structuredData,
    };
  }

  if (result.spfRecord && result.dmarcRecord) {
    const policyNote =
      result.dmarcPolicy === "none"
        ? "DMARC policy is p=none (monitor-only — no enforcement)."
        : `DMARC policy: p=${result.dmarcPolicy ?? "unspecified"}.`;
    return {
      status: FindingStatus.PASS,
      severity: Severity.GREEN,
      note: `SPF and DMARC records present. ${policyNote} ${dkimNote}`,
      structuredData,
    };
  }

  if (result.spfRecord || result.dmarcRecord) {
    const present = result.spfRecord ? "SPF" : "DMARC";
    const missing = result.spfRecord ? "DMARC" : "SPF";
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `${present} record present but no ${missing} record found. Partial email authentication leaves the domain more exposed to spoofing and deliverability problems post-transfer. ${dkimNote}`,
      structuredData,
    };
  }

  return {
    status: FindingStatus.IN_PROGRESS,
    severity: Severity.YELLOW,
    note: `Domain receives email (MX present) but has neither SPF nor DMARC records — the buyer inherits a spoofing/deliverability exposure on day one. ${dkimNote}`,
    structuredData,
  };
}

async function runMailProviderFingerprint(domain: string): Promise<TierAResult> {
  const result = await fingerprintMailProvider(domain);
  const structuredData = { ...result };

  if (result.error) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `MX lookup did not complete (${result.error}). Verify the business's email host manually.`,
      structuredData,
    };
  }

  if (result.mxHosts.length === 0) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: result.nullMx
        ? `${domain} publishes a null MX (RFC 7505) — it explicitly does not receive email. Confirm which domain carries the business's email and re-check there.`
        : `${domain} has no MX records — this domain does not receive email. Confirm which domain carries the business's email and re-check there.`,
      structuredData,
    };
  }

  return {
    status: FindingStatus.PASS,
    severity: Severity.GREEN,
    note: `MX: ${result.mxHosts.join(", ")}${result.likelyProvider ? ` (likely ${result.likelyProvider})` : ""}.`,
    structuredData,
  };
}

async function runHttpsHygiene(domain: string): Promise<TierAResult> {
  const result = await checkHttpsHygiene(domain);
  const structuredData = { ...result };

  if (!result.httpReachable && !result.httpsReachable) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Neither http://${domain} nor https://${domain} responded. Verify the site is live and check redirect behavior manually.`,
      structuredData,
    };
  }

  const hstsNote = result.hstsHeader
    ? `HSTS header present (${result.hstsHeader}).`
    : "No HSTS header observed.";

  if (result.httpRedirectsToHttps) {
    return {
      status: FindingStatus.PASS,
      severity: Severity.GREEN,
      note: `HTTP redirects to HTTPS (${result.httpRedirectChain.join(" → ")}). ${hstsNote}`,
      structuredData,
    };
  }

  if (!result.httpReachable && result.httpsReachable) {
    return {
      status: FindingStatus.PASS,
      severity: Severity.GREEN,
      note: `Port 80 does not respond; the site is served over HTTPS only. ${hstsNote}`,
      structuredData,
    };
  }

  return {
    status: FindingStatus.IN_PROGRESS,
    severity: Severity.YELLOW,
    note: `http://${domain} responds without reaching HTTPS${
      result.httpRedirectChain.length > 0 ? ` (redirect chain: ${result.httpRedirectChain.join(" → ")})` : ""
    } — visitors can land on an unencrypted page. ${hstsNote}`,
    structuredData,
  };
}

const RUNNERS: Record<string, (domain: string) => Promise<TierAResult>> = {
  domain_whois: runDomainWhois,
  dns_hosting_fingerprint: runDnsFingerprint,
  ssl_cert: runSslCheck,
  cms_fingerprint: runCmsFingerprint,
  email_auth_posture: runEmailAuthPosture,
  mail_provider_fingerprint: runMailProviderFingerprint,
  https_hygiene: runHttpsHygiene,
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

/**
 * Exposed for tests only. The domain status tables are content — which EPP codes matter to a buyer
 * and why — and content that nothing verifies drifts out of step with what registries actually
 * return, which is how the spelling mismatch got in.
 */
export const __domainStatusInternals = {
  normalizeStatus,
  BLOCKING_DOMAIN_STATUSES,
  TRANSFER_FRICTION_STATUSES,
};
