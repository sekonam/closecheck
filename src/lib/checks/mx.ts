import { promises as dns } from "node:dns";

export interface MailProviderFingerprint {
  mxHosts: string[];
  /** True when the domain publishes a null MX ("0 ." per RFC 7505) — an explicit statement that it
   * does not receive email, distinct from simply having no MX records. */
  nullMx: boolean;
  /** Best-effort guess at the email host from MX hostnames, same caveat as DnsFingerprint's
   * likelyProvider (src/lib/checks/dns.ts): a human reviews this, it is not asserted as certain. */
  likelyProvider: string | null;
  /** True when the domain itself does not resolve at all — distinct from resolving with no MX. */
  domainNotFound: boolean;
  error: string | null;
}

const KNOWN_MX_PROVIDERS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /aspmx.*google\.com|googlemail\.com|smtp\.google\.com/i, name: "Google Workspace" },
  { pattern: /protection\.outlook\.com|outlook\.com/i, name: "Microsoft 365" },
  { pattern: /zoho(mail)?\.com/i, name: "Zoho Mail" },
  { pattern: /protonmail\.ch|proton\.me/i, name: "Proton Mail" },
  { pattern: /secureserver\.net/i, name: "GoDaddy email" },
  { pattern: /emailsrvr\.com/i, name: "Rackspace Email" },
  { pattern: /mx\.yandex/i, name: "Yandex Mail" },
  { pattern: /mail\.ovh\.net/i, name: "OVH" },
  { pattern: /ionos\.|1and1\./i, name: "IONOS" },
  { pattern: /mimecast\.com/i, name: "Mimecast (gateway)" },
  { pattern: /pphosted\.com/i, name: "Proofpoint (gateway)" },
];

/**
 * ENOTFOUND and ENODATA both mean "no records came back", and both must be tolerated rather than
 * thrown — but they mean very different things and conflating them produced a confidently wrong
 * finding: a mistyped engagement domain (NXDOMAIN) was reported as "this domain does not receive
 * email", which states as fact something about a domain that does not exist.
 *
 * ENOTFOUND is NXDOMAIN — the name itself is not registered or not delegated.
 * ENODATA is "the name exists, it just has no record of this type", which is the real finding.
 */
function absenceKind(err: unknown): "nxdomain" | "no-record" | null {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOTFOUND") return "nxdomain";
  if (code === "ENODATA") return "no-record";
  return null;
}

export async function fingerprintMailProvider(domain: string): Promise<MailProviderFingerprint> {
  try {
    let domainNotFound = false;
    const records = await dns.resolveMx(domain).catch((err) => {
      const kind = absenceKind(err);
      if (kind === null) throw err;
      domainNotFound = kind === "nxdomain";
      return [];
    });
    // A null MX ("0 ." per RFC 7505) is an explicit "this domain does not receive email" — report
    // it as such rather than as a mail host named ".".
    const realRecords = records.filter((r) => r.exchange !== "." && r.exchange !== "");
    const mxHosts = realRecords
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);

    const likelyProvider =
      KNOWN_MX_PROVIDERS.find((p) => mxHosts.some((host) => p.pattern.test(host)))?.name ?? null;

    return {
      mxHosts,
      nullMx: records.length > 0 && realRecords.length === 0,
      likelyProvider,
      domainNotFound,
      error: null,
    };
  } catch (err) {
    return {
      mxHosts: [],
      nullMx: false,
      likelyProvider: null,
      domainNotFound: false,
      error: err instanceof Error ? err.message : "MX lookup failed",
    };
  }
}
