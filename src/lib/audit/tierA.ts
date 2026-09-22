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
/**
 * Whole days from now until `dateString`, rounded DOWN.
 *
 * Floor, and the history is worth keeping because the correction went the wrong way once already.
 * A review observed that an expiry "exactly 30 days out" prints as 29 and rated it Red, and called
 * that an off-by-one. It isn't: 29.98 days remaining IS less than 30 days remaining, so Red is
 * correct for a "fewer than 30 days" threshold, and 29 is the honest count of whole days left.
 *
 * Switching to ceil to satisfy that finding inverted three things at once. `Math.ceil(-0.2)` is
 * `-0`, and `-0 < 0` is false, so a domain that expired in the last 24 hours skipped the expired
 * branch entirely and printed "expires in 0 day(s)" in the future tense, losing the recovery
 * guidance. The bands moved the wrong way: 29.2 days remaining printed as "30 days" and rated
 * Yellow instead of Red. And it overstated time remaining — 89.2 days printed as 90 — which is the
 * one direction a deadline count must never err in, and which the ceil version's own docstring
 * claimed it avoided.
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
  pendingrestore: "the registration went through redemption and is mid-recovery",
  autorenewperiod: "the registration lapsed and is inside the auto-renew grace period",
  pendingtransfer: "a transfer to another registrar is already in progress",
  serverrenewprohibited: "the registry is blocking renewal",
  serverhold: "the registry has removed the domain from the zone — it will not resolve",
  clienthold: "the registrar has removed the domain from the zone — it will not resolve",
  inactive: "no nameservers are delegated — the domain does not resolve",
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
  // Clamped at zero: registries report in their own timezone and clocks skew, so a transfer date
  // a few hours in the future is routine — and "changed hands -5 day(s) ago" is not a sentence to
  // put in front of a buyer.
  if (sinceTransfer !== null && sinceTransfer < TRANSFER_LOCK_DAYS) {
    const elapsed = Math.max(0, sinceTransfer);
    notes.push(
      `Registration last changed hands ${elapsed} day(s) ago (${result.lastTransferDate}); ` +
        `ICANN's Transfer Policy locks it against transfer for ${TRANSFER_LOCK_DAYS} days, so it ` +
        `cannot move again for roughly ${TRANSFER_LOCK_DAYS - elapsed} more day(s). ` +
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
  // The registrant of record is collected and was never shown. v4's rubric makes "the registrant
  // is not the selling entity" its strongest Red trigger — a domain held personally by the owner,
  // by a former web developer, or by a marketing agency is a transfer problem however clean every
  // other answer is. It reached neither the note nor the report, because Tier A structuredData is
  // deliberately never rendered.
  const registrant = result.registrantOrg
    ? ` Registrant of record: ${result.registrantOrg} — confirm this is the entity being sold.`
    : " Registrant of record is not public (privacy shielding or registry redaction) — ask the seller to evidence control.";
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
      note: `Registration lookup did not complete automatically (${result.error}). Verify the registrar, the registrant of record, expiry and transfer status manually.`,
      structuredData,
    };
  }

  if (blockedNow) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note:
        `The registration is in a state that blocks or complicates transfer. Registrar: ` +
        `${result.registrar ?? "unknown"}.${registrant}${suffix}`,
      structuredData,
    };
  }

  const expiryDays = daysUntil(result.expiryDate);
  if (expiryDays === null) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Registration data returned with no parseable expiry date. Registrar: ${result.registrar ?? "unknown"}.${registrant} Verify the expiry manually.${suffix}`,
      structuredData,
    };
  }

  // 30/90 days is this firm's stated basis, derived from a domain needing to survive the close
  // plus a reasonable transition window — not an industry standard, because none is published.
  if (expiryDays < 0) {
    // "Domain expires in -41 day(s)" is not a sentence anyone should read in a deliverable.
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `The registration expired on ${result.expiryDate}, ${Math.abs(expiryDays)} day(s) ago. Registrar: ${result.registrar ?? "unknown"}.${registrant} Establish whether it can still be recovered before the close.${suffix}`,
      structuredData,
    };
  }
  if (expiryDays < 30) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `Domain expires in ${expiryDays} day(s) (${result.expiryDate}). Registrar: ${result.registrar ?? "unknown"}.${registrant} Confirm renewal and transfer plan before close.${suffix}`,
      structuredData,
    };
  }
  if (expiryDays < 90 || transferNotes.length > 0) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note:
        (expiryDays < 90
          ? `Domain expires in ${expiryDays} day(s) (${result.expiryDate}). Registrar: ${result.registrar ?? "unknown"}.${registrant} Confirm who is responsible for renewal post-close.`
          : `Registrar: ${result.registrar ?? "unknown"}. Expires ${result.expiryDate} (${expiryDays} days out).${registrant}`) + suffix,
      structuredData,
    };
  }
  return {
    status: FindingStatus.PASS,
    severity: Severity.GREEN,
    note: `Registrar: ${result.registrar ?? "unknown"}. Expires ${result.expiryDate} (${expiryDays} days out).${registrant}`,
    structuredData,
  };
}

async function runDnsFingerprint(domain: string): Promise<TierAResult> {
  const result = await fingerprintDns(domain);
  const structuredData = { ...result };

  // A subdomain has no NS record of its own — it is served by its parent zone's nameservers — so
  // gating on `nameservers.length === 0` reported "could not resolve DNS" for a host whose own
  // structuredData carried its A records, right beside the claim. Say what was actually missing.
  if (result.error) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Could not resolve DNS for ${domain} (${result.error}). Verify the domain is live.`,
      structuredData,
    };
  }

  if (result.nameservers.length === 0 && result.aRecords.length === 0) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `${domain} returned neither nameservers nor address records. Verify the domain is live.`,
      structuredData,
    };
  }

  if (result.nameservers.length === 0) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `${domain} resolves (${result.aRecords.join(", ")}) but publishes no nameservers of its own — it is most likely a subdomain served by a parent zone. Establish which domain actually holds the DNS, and check that one.`,
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

/**
 * Does this TLS error describe the certificate, rather than our ability to reach the host?
 *
 * Node surfaces both through the same channel with the same null certificate fields. The strings
 * here are OpenSSL/Node validation reasons; anything else (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, a
 * refusal from the host guard) is a transport problem and not a finding about the business.
 */
function isCertificateVerdict(error: string | null): boolean {
  if (!error) return false;

  // Excluded FIRST, because several of these contain words the inclusion list matches. These are
  // transport and protocol failures, not statements about the certificate: an old server that
  // cannot negotiate a modern TLS version, or a TLS connection to a plaintext port. Rating them
  // Red asserted a certificate defect that was never observed — and these are exactly the failure
  // modes of the legacy servers this product's target businesses tend to run.
  if (/protocol version|wrong version number|handshake failure|internal error|unexpected message|decode error|record layer|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|socket hang up|timed out|Not checked:/i.test(error)) {
    return false;
  }

  // Curated, not a loose keyword match. `/certificate/` alone made a DNS failure for a host called
  // "certificates.example.com" into a certificate verdict, because the hostname is in the message.
  return /(certificate|cert) has expired|CERT_HAS_EXPIRED|self[- _]signed certificate|SELF_SIGNED_CERT|unable to verify the first certificate|UNABLE_TO_VERIFY|hostname\/ip does not match|ERR_TLS_CERT_ALTNAME_INVALID|certificate is not yet valid|CERT_NOT_YET_VALID|certificate revoked|CERT_REVOKED|unable to get (local )?issuer certificate|UNABLE_TO_GET_ISSUER|depth zero self[- _]signed|DEPTH_ZERO_SELF_SIGNED_CERT|certificate chain too long|CERT_CHAIN_TOO_LONG|certificate signature failure|no certificate presented/i.test(
    error,
  );
}

/**
 * Proportion of a certificate's own lifetime still remaining, or null when the dates don't allow
 * it to be computed.
 *
 * Template v4's rubric for this item says, verbatim: "Let's Encrypt also issues six-day
 * certificates, on which two days remaining is healthy and normal. Rate on the proportion of
 * lifetime remaining, not on a day count. The 30/14/7 convention is vendor folklore." The runner
 * was still using a fixed 14/30 and therefore contradicted its own published rubric in both
 * directions — verified by driving it: a six-day certificate with two days left rated Red (and
 * under spec.md §6's worst-item rule turned the whole audit Red for a target whose renewal is
 * correctly automated), while a 200-day certificate 60 days from expiry — past the one-third line
 * the rubric's own worked example calls Yellow — rated Green.
 */
export function certificateLifetimeRemaining(
  validFrom: string | null,
  validTo: string | null,
): { fraction: number; lifetimeDays: number } | null {
  if (!validFrom || !validTo) return null;
  const from = Date.parse(validFrom);
  const to = Date.parse(validTo);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null;

  const lifetimeMs = to - from;
  const remainingMs = to - Date.now();
  return {
    fraction: remainingMs / lifetimeMs,
    lifetimeDays: Math.round(lifetimeMs / 86_400_000),
  };
}

/**
 * One third of lifetime remaining, the renewal line Let's Encrypt and Certbot 4.0.0 both adopted.
 * Below it a certificate is past when a healthy automated setup would have renewed; at or above
 * it, it is fine however few days that happens to be.
 */
const CERT_RENEWAL_FRACTION = 1 / 3;
/** Half of the renewal window gone by, i.e. one sixth of lifetime left — renewal is now overdue. */
const CERT_OVERDUE_FRACTION = 1 / 6;

/**
 * Absolute ceilings on those proportional windows.
 *
 * The proportional rule alone inverted the bug it was written to fix. Replacing a fixed 14/30-day
 * rule stopped a healthy six-day certificate rating Red — and then made every commercial one-year
 * certificate Red inside its final ~66 days and Yellow inside its final ~133. Measured live: a
 * valid DigiCert certificate on quickbooks.intuit.com with 45 days to run rated Red, which under
 * spec.md §6's worst-item rule turns an entire audit Red for a target doing nothing wrong.
 *
 * So the window is whichever is SHORTER: a proportion of the certificate's own lifetime, or a
 * plain number of days. On a six-day certificate the proportion governs (two days left is fine, as
 * v4's rubric says); on a one-year certificate the day count governs (thirty days out is fine,
 * as every commercial renewal process assumes). Both ends behave.
 *
 * The template said otherwise until v5. v4's severityGuidance told the consultant to rate on
 * proportion of lifetime and called a day count "vendor folklore" — right for short-lived
 * automated certificates, wrong for long-lived manual ones, and a description of something the
 * runner does not do. Corrected in template v5 (src/lib/templates/runnerAlignedThresholds.ts)
 * rather than by bending the code back to match it. Audits started on v4 stay on v4's rule, which
 * is what the version pin is for.
 */
const CERT_RENEWAL_MAX_DAYS = 30;
const CERT_OVERDUE_MAX_DAYS = 14;
/**
 * Tolerance around those lines, so a certificate sitting exactly on one is not rated by a rounding
 * error.
 *
 * This is not cosmetic. The rubric's own worked example — two days left on a six-day certificate —
 * is EXACTLY one third, and without a tolerance the elapsed milliseconds between issue-time
 * arithmetic and `Date.now()` put it a hair below the line and rated it Yellow. A renewal running
 * precisely on schedule is the healthiest state there is, and it must not be the one that trips a
 * threshold. Found by a boundary test, not by reading.
 */
const CERT_FRACTION_TOLERANCE = 0.001;

async function runSslCheck(domain: string): Promise<TierAResult> {
  const result = await fingerprintSsl(domain);
  const structuredData = { ...result };

  // A host we declined to reach, or could not reach, is not a certificate verdict. Every other
  // runner degrades a transport failure to IN_PROGRESS/YELLOW; this one escalated it to a Red
  // FINDING, so a mistyped domain on the engagement turned the entire audit Red — and the note
  // "Certificate check failed" reads to a buyer as a statement about the certificate rather than
  // about our ability to connect.
  //
  // But a handshake that fails BECAUSE of the certificate is a verdict, and a Red one. Node
  // reports those through the same error channel as a DNS failure, and the certificate fields come
  // back null either way — so the two are told apart by the reason, not by the absence of data.
  // Getting this wrong in the safe-looking direction would silently downgrade a genuinely expired
  // certificate to "we couldn't check", which is worse than the over-escalation it replaced.
  const unreachable = result.validTo === null && result.issuer === null && !isCertificateVerdict(result.error);
  if (unreachable) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: result.error
        ? `Could not complete a TLS check for ${domain} (${result.error}). Verify the certificate manually.`
        : `Could not complete a TLS check for ${domain}. Verify the certificate manually.`,
      structuredData,
    };
  }

  // A certificate that was presented and is not trusted IS a verdict, and a Red one.
  if (!result.valid) {
    if (result.validTo === null) {
      // The handshake failed on the certificate before it could be read — the reason is all we
      // have, and it is enough to rate on.
      return {
        status: FindingStatus.FAIL,
        severity: Severity.RED,
        note: `The certificate served by ${domain} failed validation: ${result.error}. Nothing further could be read from it.`,
        structuredData,
      };
    }
    const expired =
      result.daysUntilExpiry !== null && result.daysUntilExpiry < 0
        ? ` It expired on ${result.validTo}.`
        : "";
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `The certificate served by ${domain} is not trusted: ${result.error ?? "it failed validation"}.${expired}`,
      structuredData,
    };
  }

  if (result.daysUntilExpiry !== null && result.daysUntilExpiry < 0) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      note: `The certificate expired on ${result.validTo}. Issuer: ${result.issuer ?? "unknown"}.`,
      structuredData,
    };
  }

  const remaining = certificateLifetimeRemaining(result.validFrom, result.validTo);
  const daysNote =
    result.daysUntilExpiry !== null ? `${result.daysUntilExpiry} day(s) left` : "expiry unknown";

  if (remaining) {
    const lifetime = `on a ${remaining.lifetimeDays}-day certificate`;
    const daysLeft = result.daysUntilExpiry ?? remaining.fraction * remaining.lifetimeDays;
    // Whichever window is shorter — see the constants above for why both are needed.
    const renewalDays = Math.min(remaining.lifetimeDays * CERT_RENEWAL_FRACTION, CERT_RENEWAL_MAX_DAYS);
    const overdueDays = Math.min(remaining.lifetimeDays * CERT_OVERDUE_FRACTION, CERT_OVERDUE_MAX_DAYS);
    const tolerance = remaining.lifetimeDays * CERT_FRACTION_TOLERANCE;

    if (daysLeft < overdueDays - tolerance) {
      return {
        status: FindingStatus.FAIL,
        severity: Severity.RED,
        // Naming the window that actually governed. Saying "past one third of lifetime" when the
        // day ceiling is what fired would be a false statement about why — 25 days left on a
        // 366-day certificate is nowhere near its one-third point.
        note: `Renewal is overdue: ${daysNote} ${lifetime} (${result.validTo}), inside the ${Math.round(overdueDays)}-day mark where renewal should already have happened. Issuer: ${result.issuer ?? "unknown"}. Ask who is responsible for renewing it.`,
        structuredData,
      };
    }
    if (daysLeft < renewalDays - tolerance) {
      return {
        status: FindingStatus.IN_PROGRESS,
        severity: Severity.YELLOW,
        note: `${daysNote} ${lifetime} (${result.validTo}) — inside the ${Math.round(renewalDays)}-day window where renewal would normally have run. Issuer: ${result.issuer ?? "unknown"}. Confirm renewal is automated and who owns it.`,
        structuredData,
      };
    }
    return {
      status: FindingStatus.PASS,
      severity: Severity.GREEN,
      note: `Valid certificate from ${result.issuer ?? "unknown issuer"} — ${daysNote} ${lifetime}, expiring ${result.validTo}.`,
      structuredData,
    };
  }

  // No usable issue date, so lifetime is unknowable. Report what was observed rather than falling
  // back to a day count the rubric rejects.
  return {
    status: FindingStatus.PASS,
    severity: Severity.GREEN,
    note: `Valid certificate from ${result.issuer ?? "unknown issuer"}, expiring ${result.validTo} (${daysNote}). Certificate lifetime could not be determined, so renewal timing was not assessed.`,
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

  const additionalPlatforms = result.signals
    .map((signal) => /^matched signature:\s*(.+)$/.exec(signal)?.[1]?.trim())
    .filter((name): name is string => Boolean(name));

  // Deliberately not scoring a severity from version alone (docs/idea.md's evidentiary bar,
  // .claude/skills/audit-methodology/SKILL.md): a bare version string is not evidence of a known
  // vulnerability without checking it against something. Flag for manual review instead of guessing.
  return {
    status: FindingStatus.IN_PROGRESS,
    severity: Severity.YELLOW,
    // Every matched signature, not just the first. A site matching both WordPress and WooCommerce
    // was reported as WordPress alone, silently dropping a payment surface from the client-facing
    // note — and what else is running on the platform is precisely what a buyer is inheriting.
    note: `Detected ${[...new Set([result.cms, ...additionalPlatforms])].join(", ")}${result.version ? ` (version signal: ${result.version})` : ""}. Confirm patch status manually — this is a fingerprint, not an assertion of vulnerability status from a version string.`,
    structuredData,
  };
}

async function runEmailAuthPosture(domain: string): Promise<TierAResult> {
  const result = await checkEmailAuth(domain);
  const structuredData = { ...result };
  // A domain that does not resolve at all cannot be said to have made any choice about email.
  // Reporting NXDOMAIN as "this domain does not receive email" states a confident fact about a
  // name that is not registered — and a mistyped engagement domain produced three such statements
  // across three findings.
  if (result.domainNotFound) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `${domain} does not resolve — the name is not registered, or not delegated. Confirm the business's actual domain before treating anything here as a finding.`,
      structuredData,
    };
  }


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
  // A domain that does not resolve at all cannot be said to have made any choice about email.
  // Reporting NXDOMAIN as "this domain does not receive email" states a confident fact about a
  // name that is not registered — and a mistyped engagement domain produced three such statements
  // across three findings.
  if (result.domainNotFound) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `${domain} does not resolve — the name is not registered, or not delegated. Confirm the business's actual domain before treating anything here as a finding.`,
      structuredData,
    };
  }


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

  // The check reports a refused host in `error` and this runner never read it, so "we declined to
  // fetch this" printed as "neither http:// nor https:// responded" — the exact confusion the
  // check's own module comment says must never happen.
  if (result.error?.startsWith("Not checked:")) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `${result.error}. Check redirect behaviour and HSTS manually.`,
      structuredData,
    };
  }

  if (!result.httpReachable && !result.httpsReachable) {
    return {
      status: FindingStatus.IN_PROGRESS,
      severity: Severity.YELLOW,
      note: `Neither http://${domain} nor https://${domain} responded. Verify the site is live and check redirect behavior manually.`,
      structuredData,
    };
  }

  // Only state what was actually obtained. With no HTTPS response there is no header to have
  // observed, and "No HSTS header observed" asserted an observation that never happened.
  const hstsNote = !result.httpsReachable
    ? "HSTS could not be checked — no usable HTTPS response was obtained."
    : result.hstsHeader
      ? `HSTS header present (${result.hstsHeader}).`
      : "No HSTS header observed.";

  // A redirect INTO an endpoint that does not answer is not working HTTPS. Rating this Green put
  // "Green — HTTP redirects to HTTPS" beside a Red expired-certificate finding for the same host.
  if (result.httpRedirectsToHttps && !result.httpsReachable) {
    return {
      status: FindingStatus.FAIL,
      severity: Severity.RED,
      // "Did not respond" is the honest phrasing only when nothing answered. A server that
      // answered and was rejected on its certificate DID respond, and the certificate item already
      // says so — counting one root cause as two Reds and misstating the second is worse than
      // silence.
      note: `http://${domain} redirects to HTTPS (${result.httpRedirectChain.join(" → ")}), but the HTTPS endpoint could not be reached over a trusted connection — visitors following that redirect do not arrive. ${hstsNote}`,
      structuredData,
    };
  }

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
    note: `http://${domain} responded without redirecting to HTTPS. ${hstsNote}`,
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
  isCertificateVerdict,
  CERT_RENEWAL_FRACTION,
  CERT_OVERDUE_FRACTION,
  CERT_FRACTION_TOLERANCE,
  // Exposed so the policy watch can assert its consultant-facing notice still states the same
  // number this runner actually applies (src/lib/templates/policyWatch.test.ts). The notice and
  // this constant describe one fact from two places, and the fact is expected to change.
  TRANSFER_LOCK_DAYS,
};
