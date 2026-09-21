import { promises as dns } from "node:dns";

export interface EmailAuthPosture {
  hasMx: boolean;
  /** True when the domain publishes a null MX ("0 ." per RFC 7505) — an explicit statement that it
   * does not receive email, distinct from simply having no MX records. */
  nullMx: boolean;
  spfRecord: string | null;
  dmarcRecord: string | null;
  /** Parsed `p=` policy from the DMARC record ("none" | "quarantine" | "reject"), if present. */
  dmarcPolicy: string | null;
  /** Selectors from COMMON_DKIM_SELECTORS that resolved to a DKIM TXT record. Best-effort only:
   * selectors are provider-chosen and cannot be enumerated from public DNS, so an empty array is
   * NOT evidence DKIM is absent (docs/spec.md §4's DKIM note) — it must never drive severity. */
  dkimSelectorsFound: string[];
  error: string | null;
}

const COMMON_DKIM_SELECTORS = ["google", "selector1", "selector2", "k1", "default", "mail"];

function isAbsence(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "ENOTFOUND" || code === "ENODATA";
}

/** Resolves TXT records at a name, joined per-record; [] when the name/record doesn't exist,
 * rethrows anything that isn't a clean "no such record" answer. */
async function resolveTxtJoined(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch (err) {
    if (isAbsence(err)) return [];
    throw err;
  }
}

export async function checkEmailAuth(domain: string): Promise<EmailAuthPosture> {
  try {
    const [mxRecords, rootTxt, dmarcTxt] = await Promise.all([
      dns.resolveMx(domain).catch((err) => {
        if (isAbsence(err)) return [];
        throw err;
      }),
      resolveTxtJoined(domain),
      resolveTxtJoined(`_dmarc.${domain}`),
    ]);

    const spfRecord = rootTxt.find((t) => /^v=spf1(\s|$)/i.test(t)) ?? null;
    const dmarcRecord = dmarcTxt.find((t) => /^v=DMARC1\b/i.test(t)) ?? null;
    const dmarcPolicy = dmarcRecord?.match(/\bp\s*=\s*([a-z]+)/i)?.[1]?.toLowerCase() ?? null;

    const dkimSelectorsFound = (
      await Promise.all(
        COMMON_DKIM_SELECTORS.map(async (selector) => {
          const records = await resolveTxtJoined(`${selector}._domainkey.${domain}`).catch(() => []);
          // Requires a DKIM tag AND a non-empty p= key: "v=DKIM1; p=" (empty p) is a revoked key
          // per RFC 6376 §3.6.1 — example.com publishes exactly that as a wildcard, so a looser
          // match reports working DKIM where none exists.
          return records.some((t) => /v=DKIM1|k=(rsa|ed25519)/i.test(t) && /(^|;)\s*p\s*=\s*[^;\s]/.test(t))
            ? selector
            : null;
        }),
      )
    ).filter((s): s is string => s !== null);

    // A null MX ("0 ." per RFC 7505) is an explicit "this domain does not receive email", not a
    // deliverable mail host — don't count it as one.
    const realMx = mxRecords.filter((r) => r.exchange !== "." && r.exchange !== "");

    return {
      hasMx: realMx.length > 0,
      nullMx: mxRecords.length > 0 && realMx.length === 0,
      spfRecord,
      dmarcRecord,
      dmarcPolicy,
      dkimSelectorsFound,
      error: null,
    };
  } catch (err) {
    return {
      hasMx: false,
      nullMx: false,
      spfRecord: null,
      dmarcRecord: null,
      dmarcPolicy: null,
      dkimSelectorsFound: [],
      error: err instanceof Error ? err.message : "DNS lookup failed",
    };
  }
}
