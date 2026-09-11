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

export async function fingerprintDns(hostname: string): Promise<DnsFingerprint> {
  try {
    const [nameservers, aRecords, mxRecords] = await Promise.all([
      dns.resolveNs(hostname).catch(() => [] as string[]),
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns
        .resolveMx(hostname)
        .then((records) => records.map((r) => r.exchange))
        .catch(() => [] as string[]),
    ]);

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
