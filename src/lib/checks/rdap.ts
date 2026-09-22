import type { WhoisResult } from "./whois";

/**
 * RDAP domain lookup (the registry protocol that replaced WHOIS — ICANN sunset legacy port-43
 * WHOIS in January 2025, and hundreds of gTLDs no longer answer on it at all; see spec.md §10 and
 * docs/research/profitability.md §3). Same Tier A posture as the legacy path: best-effort
 * automation whose result a consultant reviews either way, so every failure mode degrades to a
 * populated `error` for manual follow-up, never a throw.
 *
 * Server discovery uses IANA's RDAP bootstrap registry rather than a hardcoded server table, for
 * the same reason the legacy path used the IANA referral hop: TLD → server mappings change.
 */

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

type VcardProperty = [string, Record<string, unknown>, string, ...unknown[]];

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, VcardProperty[]];
  entities?: RdapEntity[];
}

export interface RdapDomainResponse {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  /** EPP status codes, per RFC 9083 §4.6. */
  status?: string[];
}

interface BootstrapFile {
  services?: [string[], string[]][];
}

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let bootstrapCache: { fetchedAt: number; tldToBase: Map<string, string> } | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/rdap+json, application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return (await response.json()) as T;
}

async function rdapBaseForTld(tld: string): Promise<string | null> {
  if (!bootstrapCache || Date.now() - bootstrapCache.fetchedAt > BOOTSTRAP_TTL_MS) {
    const file = await fetchJson<BootstrapFile>(BOOTSTRAP_URL);
    const tldToBase = new Map<string, string>();
    for (const [tlds, urls] of file.services ?? []) {
      const httpsBase = urls.find((u) => u.startsWith("https://")) ?? urls[0];
      if (!httpsBase) continue;
      for (const entry of tlds) tldToBase.set(entry.toLowerCase(), httpsBase);
    }
    bootstrapCache = { fetchedAt: Date.now(), tldToBase };
  }
  return bootstrapCache.tldToBase.get(tld.toLowerCase()) ?? null;
}

function vcardValue(entity: RdapEntity, property: string): string | null {
  const props = entity.vcardArray?.[1];
  if (!Array.isArray(props)) return null;
  for (const prop of props) {
    if (Array.isArray(prop) && prop[0]?.toLowerCase() === property && typeof prop[3] === "string") {
      const value = prop[3].trim();
      if (value) return value;
    }
  }
  return null;
}

function findEntityByRole(entities: RdapEntity[] | undefined, role: string): RdapEntity | null {
  for (const entity of entities ?? []) {
    if (entity.roles?.some((r) => r.toLowerCase() === role)) return entity;
    const nested = findEntityByRole(entity.entities, role);
    if (nested) return nested;
  }
  return null;
}

function eventDate(response: RdapDomainResponse, action: string): string | null {
  const event = response.events?.find((e) => e.eventAction?.toLowerCase() === action);
  return event?.eventDate ?? null;
}

/** Pure parse step, separated from the network hops so it can be tested against fixtures. */
export function parseRdapDomain(response: RdapDomainResponse): Omit<WhoisResult, "raw" | "error"> {
  const registrarEntity = findEntityByRole(response.entities, "registrar");
  const registrantEntity = findEntityByRole(response.entities, "registrant");
  return {
    registrar: registrarEntity ? vcardValue(registrarEntity, "fn") : null,
    createdDate: eventDate(response, "registration"),
    // "transfer" is the registry's own record of the registration changing hands, which is what
    // the 60-day transfer lock runs from. "last changed" is any modification and is a weaker
    // signal — kept separate rather than collapsed, because conflating them would turn a routine
    // contact-detail edit into a false transfer-lock warning.
    lastTransferDate: eventDate(response, "transfer"),
    lastChangedDate: eventDate(response, "last changed"),
    statuses: response.status ?? [],
    // Registrant org is frequently redacted post-GDPR; null here means "read `raw` manually",
    // matching the legacy WHOIS behavior the consultant workflow already expects.
    registrantOrg: registrantEntity
      ? (vcardValue(registrantEntity, "org") ?? vcardValue(registrantEntity, "fn"))
      : null,
    expiryDate: eventDate(response, "expiration"),
  };
}

export async function lookupRdap(domain: string): Promise<WhoisResult> {
  const empty = {
    registrar: null,
    createdDate: null,
    expiryDate: null,
    registrantOrg: null,
    lastTransferDate: null,
    lastChangedDate: null,
    statuses: [] as string[],
  };
  const tld = domain.split(".").pop();
  if (!tld) return { ...empty, raw: null, error: "Could not determine TLD" };

  try {
    const base = await rdapBaseForTld(tld);
    if (!base) return { ...empty, raw: null, error: `No RDAP server registered for .${tld}` };

    const url = `${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`;
    const response = await fetchJson<RdapDomainResponse>(url);
    return {
      ...parseRdapDomain(response),
      raw: JSON.stringify(response, null, 2),
      error: null,
    };
  } catch (err) {
    return {
      ...empty,
      raw: null,
      error: err instanceof Error ? err.message : "RDAP lookup failed",
    };
  }
}

/** Test hook: reset the module-level bootstrap cache between tests. */
export function __resetRdapBootstrapCacheForTests(): void {
  bootstrapCache = null;
}
