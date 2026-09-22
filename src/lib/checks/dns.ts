import { promises as dns } from "node:dns";

export interface DnsFingerprint {
  nameservers: string[];
  aRecords: string[];
  mxRecords: string[];
  /** Best-effort guess at the hosting/DNS provider from nameserver hostnames — e.g.
   * "ns1.p03.dynect.net" -> "dynect". Not authoritative; a human reviews this (spec.md §4, Tier A is
   * "manual, best-effort" for CMS/hosting fingerprinting). */
  likelyProvider: string | null;
  error: string | null;
}

const KNOWN_NS_PROVIDERS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /cloudflare/i, name: "Cloudflare" },
  { pattern: /awsdns/i, name: "AWS Route 53" },
  { pattern: /googledomains|google\.com/i, name: "Google Domains/Cloud DNS" },
  { pattern: /azure-dns/i, name: "Azure DNS" },
  { pattern: /dynect|dyn\.com/i, name: "Oracle Dyn" },
  { pattern: /domaincontrol/i, name: "GoDaddy" },
  { pattern: /namecheaphosting/i, name: "Namecheap" },
  { pattern: /squarespace/i, name: "Squarespace" },
  { pattern: /wixdns/i, name: "Wix" },
  { pattern: /shopify/i, name: "Shopify" },
];

/**
 * "No records of this type" and "the resolver failed" both produce an empty array, and collapsing
 * them made every lookup look successful — `error` was structurally always null, so the runner's
 * error branch was dead code and a resolver outage reported as "this domain publishes nothing",
 * which is a false observation rather than a failed check.
 *
 * ENODATA and NXDOMAIN are genuine absences and stay absences; anything else is a failure and is
 * reported as one.
 */
async function resolveOrFail<T>(lookup: Promise<T[]>, failures: string[]): Promise<T[]> {
  try {
    return await lookup;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    failures.push(code ?? (err instanceof Error ? err.message : "lookup failed"));
    return [];
  }
}

export async function fingerprintDns(hostname: string): Promise<DnsFingerprint> {
  try {
    const failures: string[] = [];
    const [nameservers, aRecords, mxRecords] = await Promise.all([
      resolveOrFail(dns.resolveNs(hostname), failures),
      resolveOrFail(dns.resolve4(hostname), failures),
      resolveOrFail(
        dns.resolveMx(hostname).then((records) => records.map((r) => r.exchange)),
        failures,
      ),
    ]);

    if (failures.length > 0 && nameservers.length === 0 && aRecords.length === 0) {
      // Only when nothing at all came back: a partial failure alongside real records is worth
      // reporting as the records it did find, not as a failed lookup.
      return {
        nameservers,
        aRecords,
        mxRecords,
        likelyProvider: null,
        error: `DNS lookup failed (${[...new Set(failures)].join(", ")})`,
      };
    }

    const likelyProvider =
      KNOWN_NS_PROVIDERS.find((p) => nameservers.some((ns) => p.pattern.test(ns)))?.name ?? null;

    return { nameservers, aRecords, mxRecords, likelyProvider, error: null };
  } catch (err) {
    return {
      nameservers: [],
      aRecords: [],
      mxRecords: [],
      likelyProvider: null,
      error: err instanceof Error ? err.message : "DNS lookup failed",
    };
  }
}
