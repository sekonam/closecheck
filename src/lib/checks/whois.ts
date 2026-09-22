import { connect } from "node:net";

import { lookupRdap } from "./rdap";

export interface WhoisResult {
  registrar: string | null;
  createdDate: string | null;
  expiryDate: string | null;
  registrantOrg: string | null;
  raw: string | null;
  error: string | null;
}

function queryWhoisServer(server: string, query: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: server, port: 43, timeout: timeoutMs });
    let data = "";

    socket.on("connect", () => socket.write(`${query}\r\n`));
    socket.on("data", (chunk) => (data += chunk.toString("utf8")));
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("WHOIS query timed out"));
    });
  });
}

function extractField(raw: string, labels: string[]): string | null {
  for (const line of raw.split(/\r?\n/)) {
    for (const label of labels) {
      if (line.toLowerCase().startsWith(label.toLowerCase())) {
        const value = line.slice(line.indexOf(":") + 1).trim();
        if (value) return value;
      }
    }
  }
  return null;
}

/**
 * Domain registration lookup: RDAP first, legacy port-43 WHOIS as fallback.
 *
 * RDAP is the primary path because ICANN sunset legacy WHOIS in January 2025 and hundreds of
 * gTLDs no longer answer on port 43 at all (spec.md §10, roadmap.md Phase 2.5). The legacy
 * two-hop path below is kept only as a fallback for ccTLDs still absent from IANA's RDAP
 * bootstrap registry. This is a Tier A item (spec.md §4): best-effort automation, human reviews
 * the result either way — so both paths degrade to a populated `error`, never a throw.
 */
export async function lookupWhois(domain: string): Promise<WhoisResult> {
  const rdap = await lookupRdap(domain);
  if (!rdap.error) return rdap;

  const legacy = await legacyWhoisLookup(domain);
  if (legacy.error) {
    return { ...legacy, error: `RDAP: ${rdap.error}; legacy WHOIS: ${legacy.error}` };
  }
  return legacy;
}

/**
 * Two-hop legacy WHOIS: ask IANA which registry server handles this TLD, then query that server
 * directly. Covers TLDs without a hardcoded server table; some registries redirect again or return
 * thin/no data over port 43 — those surface as a null field with `raw` populated, for the
 * consultant to read directly, rather than a hard failure.
 */
async function legacyWhoisLookup(domain: string): Promise<WhoisResult> {
  const tld = domain.split(".").pop();
  if (!tld) {
    return {
      registrar: null,
      createdDate: null,
      expiryDate: null,
      registrantOrg: null,
      raw: null,
      error: "Could not determine TLD",
    };
  }

  try {
    const ianaResponse = await queryWhoisServer("whois.iana.org", tld);
    const referralServer = extractField(ianaResponse, ["whois:"]);

    const server = referralServer ?? "whois.iana.org";
    const raw = await queryWhoisServer(server, domain);

    return {
      registrar: extractField(raw, ["Registrar:", "Sponsoring Registrar:"]),
      createdDate: extractField(raw, ["Creation Date:", "created:", "Registered on:"]),
      expiryDate: extractField(raw, ["Registry Expiry Date:", "Expiration Date:", "expires:"]),
      registrantOrg: extractField(raw, ["Registrant Organization:", "Registrant:"]),
      raw,
      error: null,
    };
  } catch (err) {
    return {
      registrar: null,
      createdDate: null,
      expiryDate: null,
      registrantOrg: null,
      raw: null,
      error: err instanceof Error ? err.message : "WHOIS lookup failed",
    };
  }
}
