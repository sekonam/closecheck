/**
 * Is a host safe for this server to make an outbound request to?
 *
 * WHAT THIS IS FOR
 * ----------------
 * Two places in this product take a host from a user and then connect to it from the server: the
 * Tier A check runner (`Engagement.primaryDomain`, src/lib/audit/tierA.ts) and webhook delivery
 * (`WebhookEndpoint.url`, src/lib/webhooks/dispatch.ts). Without a guard, either becomes a
 * server-side request forgery primitive — a consultant can point the product at `169.254.169.254`
 * and have it fetch cloud instance metadata, or at an internal host that is only reachable from
 * inside the deployment network.
 *
 * The Tier A case is the more dangerous of the two, because the *response* is persisted into the
 * finding and rendered back to the user: redirect chains, HSTS headers, CMS `generator` tags, and
 * TLS certificate subjects all come back. So this has to handle a genuinely hostile input, not
 * just a misconfigured one.
 *
 * WHAT THIS IS NOT
 * ----------------
 * **A hostname check is not a DNS-rebinding defence, and this module is not an egress policy.**
 * `evil.com` that resolves to `169.254.169.254` passes any name-based check, and even a
 * resolve-then-check can be defeated by a record whose TTL expires between the check and the
 * connection. Closing that properly means pinning the resolved address into the connection itself,
 * or an egress firewall — neither of which exists here.
 *
 * `assertPublicHost` below therefore does resolve-then-check, which raises the bar considerably
 * (it stops the plain "point a DNS record at the metadata endpoint" attack) without claiming to
 * eliminate the class. Callers whose responses are reflected back to the user should treat that as
 * defence in depth, not as a reason to relax what they reflect.
 */

import { lookup } from "node:dns/promises";

export type HostVerdict = { safe: true } | { safe: false; reason: string };

// ---------------------------------------------------------------------------
// Address parsing
// ---------------------------------------------------------------------------

/**
 * Parse an IPv4 literal in every form the C `inet_aton` family accepts, because that is what the
 * network stack accepts and therefore what an attacker gets to use.
 *
 * A guard that only understands dotted-decimal is bypassed by writing the same address another
 * way: `2852039166`, `0xA9FEA9FE`, and `0251.254.169.254` all reach 169.254.169.254. Returns the
 * address as a 32-bit number, or null if the string is not an IPv4 literal at all.
 */
export function parseIPv4(input: string): number | null {
  if (input === "") return null;
  const parts = input.split(".");
  if (parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    if (part === "") return null;
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      value = parseInt(part.slice(2), 16);
    } else if (/^0[0-9]+$/.test(part)) {
      // A leading zero means octal. If the digits aren't valid octal the whole literal is
      // malformed — reject rather than quietly reinterpreting it as decimal, which would make this
      // parser disagree with the resolver about what address the string names. Disagreement is the
      // bug class this guard exists to prevent; a rejected literal falls through to the hostname
      // path and simply fails to resolve.
      if (!/^0[0-7]+$/.test(part)) return null;
      value = parseInt(part.slice(1), 8);
    } else if (/^[0-9]+$/.test(part)) {
      value = parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(value) || value < 0) return null;
    values.push(value);
  }

  // inet_aton semantics: with fewer than four parts, the final part supplies all remaining bytes.
  // "127.1" is 127.0.0.1; "2130706433" is the whole address in one part.
  const lastMax = 256 ** (4 - values.length + 1);
  const last = values[values.length - 1];
  if (last >= lastMax) return null;
  for (const value of values.slice(0, -1)) {
    if (value > 255) return null;
  }

  let address = 0;
  for (let i = 0; i < values.length - 1; i += 1) {
    address += values[i] * 256 ** (3 - i);
  }
  address += last;
  return address >>> 0;
}

function ipv4InRange(address: number, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const baseAddress = parseIPv4(base);
  if (baseAddress === null) return false;
  const bits = Number(bitsText);
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) >>> 0 === (baseAddress & mask) >>> 0;
}

/** Ranges that must never be reachable from a user-supplied host. */
const BLOCKED_IPV4: Array<[string, string]> = [
  ["0.0.0.0/8", "this-network"],
  ["10.0.0.0/8", "private"],
  ["100.64.0.0/10", "carrier-grade NAT"],
  ["127.0.0.0/8", "loopback"],
  ["169.254.0.0/16", "link-local (includes cloud instance metadata)"],
  ["172.16.0.0/12", "private"],
  ["192.0.0.0/24", "IETF protocol assignments"],
  ["192.168.0.0/16", "private"],
  ["198.18.0.0/15", "benchmarking"],
  ["224.0.0.0/4", "multicast"],
  ["240.0.0.0/4", "reserved"],
];

function ipv4Verdict(address: number): HostVerdict {
  for (const [cidr, label] of BLOCKED_IPV4) {
    if (ipv4InRange(address, cidr)) {
      return { safe: false, reason: `resolves into ${cidr} (${label})` };
    }
  }
  return { safe: true };
}

/**
 * Expand an IPv6 literal to its sixteen bytes, or null if it isn't one.
 *
 * Handles `::` compression and a trailing dotted-quad (which is how IPv4-mapped and NAT64
 * addresses are written), because those are the forms that smuggle an IPv4 address past a guard
 * that only looks at the text.
 */
export function parseIPv6(input: string): Uint8Array | null {
  let text = input;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // A zone index ("%eth0") is not meaningful for an outbound connection here; strip and ignore.
  const zoneAt = text.indexOf("%");
  if (zoneAt !== -1) text = text.slice(0, zoneAt);
  if (!text.includes(":")) return null;

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const afterLastColon = text.slice(lastColon + 1);
  if (afterLastColon.includes(".")) {
    // Only plain dotted-quad is valid inside an IPv6 literal, but parse permissively and then
    // require it to be four dotted parts, so "::ffff:0x7f000001" isn't silently accepted as v6.
    if (afterLastColon.split(".").length !== 4) return null;
    const embedded = parseIPv4(afterLastColon);
    if (embedded === null) return null;
    tail = [(embedded >>> 24) & 0xff, (embedded >>> 16) & 0xff, (embedded >>> 8) & 0xff, embedded & 0xff];
    text = text.slice(0, lastColon + 1) + "0";
  }

  const doubleColonAt = text.indexOf("::");
  let headGroups: string[];
  let tailGroups: string[];
  if (doubleColonAt === -1) {
    headGroups = text.split(":");
    tailGroups = [];
  } else {
    if (text.indexOf("::", doubleColonAt + 1) !== -1) return null; // only one :: allowed
    headGroups = text.slice(0, doubleColonAt).split(":").filter((g) => g !== "");
    tailGroups = text.slice(doubleColonAt + 2).split(":").filter((g) => g !== "");
  }

  const groupBytes = (group: string): number[] | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    return [(value >> 8) & 0xff, value & 0xff];
  };

  const head: number[] = [];
  for (const group of headGroups) {
    const bytes = groupBytes(group);
    if (!bytes) return null;
    head.push(...bytes);
  }
  const back: number[] = [];
  for (const group of tailGroups) {
    const bytes = groupBytes(group);
    if (!bytes) return null;
    back.push(...bytes);
  }

  // The trailing dotted-quad contributed a placeholder group above; drop it and append the real
  // four bytes at the very end.
  if (tail.length > 0) {
    if (back.length >= 2) back.splice(back.length - 2, 2);
    else if (head.length >= 2) head.splice(head.length - 2, 2);
    else return null;
  }

  const fill = 16 - head.length - back.length - tail.length;
  if (fill < 0) return null;
  if (doubleColonAt === -1 && fill !== 0) return null;

  return new Uint8Array([...head, ...new Array(fill).fill(0), ...back, ...tail]);
}

function ipv6Verdict(bytes: Uint8Array): HostVerdict {
  const isZeroPrefix = (length: number) => bytes.slice(0, length).every((b) => b === 0);

  // ::1 and :: sit numerically inside ::/96 but are not IPv4-compatible addresses — they are
  // loopback and the unspecified address. They have to be recognised before the embedding branches
  // below, or ::1 reads as "embeds 0.0.0.1" and gets blocked for the wrong stated reason.
  if (bytes.every((b) => b === 0)) return { safe: false, reason: "is the unspecified address (::)" };
  if (isZeroPrefix(15) && bytes[15] === 1) return { safe: false, reason: "is IPv6 loopback (::1)" };

  const embeddedIPv4 = () =>
    ipv4Verdict(((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0);

  // Every form that carries an IPv4 address in the low 32 bits gets unwrapped and judged as IPv4,
  // otherwise ::ffff:169.254.169.254 walks straight past every v6 range check below:
  //   ::ffff:a.b.c.d    IPv4-mapped
  //   ::a.b.c.d         IPv4-compatible (deprecated, but still parses and still names the address)
  //   ::ffff:0:a.b.c.d  IPv4-translated
  // The deprecated and translated forms were previously described here as handled and were not —
  // ::127.0.0.1 and ::169.254.169.254 both returned safe.
  if (isZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return embeddedIPv4();
  if (isZeroPrefix(8) && bytes[8] === 0xff && bytes[9] === 0xff && bytes[10] === 0 && bytes[11] === 0) {
    return embeddedIPv4();
  }
  // Anything else in ::/96 is an IPv4-compatible address.
  if (isZeroPrefix(12)) return embeddedIPv4();
  // NAT64 well-known prefix 64:ff9b::/96.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && isZeroPrefix(1)) {
    return ipv4Verdict(((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0);
  }
  // 6to4 2002::/16 embeds an IPv4 address in bytes 2-5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return ipv4Verdict(((bytes[2] << 24) | (bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) >>> 0);
  }

  if ((bytes[0] & 0xfe) === 0xfc) return { safe: false, reason: "is in fc00::/7 (unique local)" };
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return { safe: false, reason: "is in fe80::/10 (link-local)" };
  if (bytes[0] === 0xff) return { safe: false, reason: "is IPv6 multicast (ff00::/8)" };

  return { safe: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Judge a host WITHOUT resolving it: rejects literal addresses in non-public ranges, and names
 * that cannot route publicly at all.
 *
 * Operates on a hostname, not a URL — scheme, port, credential and redirect rules are
 * caller-specific (webhook delivery requires https and refuses redirects; Tier A does not) and
 * stay with the caller rather than migrating in here.
 */
export function isPublicHostLiteral(host: string): HostVerdict {
  const hostname = host.trim().toLowerCase();
  if (hostname === "") return { safe: false, reason: "is empty" };

  const ipv6 = parseIPv6(hostname);
  if (ipv6) return ipv6Verdict(ipv6);

  const ipv4 = parseIPv4(hostname);
  if (ipv4 !== null) return ipv4Verdict(ipv4);

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { safe: false, reason: "is localhost" };
  }
  // Single-label names ("intranet", "db") only resolve through a search domain, which means they
  // can only ever name something inside the deployment's own network.
  if (!hostname.includes(".")) {
    return { safe: false, reason: "is not a fully-qualified public hostname" };
  }
  // RFC 6761/8375 special-use names that are, by definition, local.
  if (/\.(local|internal|localdomain|home\.arpa|intranet|corp|lan)$/.test(hostname)) {
    return { safe: false, reason: "is a reserved internal-use name" };
  }

  return { safe: true };
}

/**
 * Judge a host by what it actually resolves to.
 *
 * Every returned address must be public — a name with one public and one link-local address is
 * rejected, because which one gets connected to is not ours to choose. A name that does not
 * resolve is allowed through: the connection will fail on its own, and treating NXDOMAIN as a
 * safety failure would turn "this business's domain has expired" (a real, common Tier A finding)
 * into a security error.
 *
 * See the module header: this raises the bar on DNS-based attacks but is not a rebinding defence.
 */
export async function assertPublicHost(host: string): Promise<HostVerdict> {
  const literal = isPublicHostLiteral(host);
  if (!literal.safe) return literal;

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return { safe: true };
  }

  for (const { address, family } of addresses) {
    const verdict =
      family === 6
        ? (() => {
            const bytes = parseIPv6(address);
            return bytes ? ipv6Verdict(bytes) : ({ safe: false, reason: "resolved to an unparseable address" } as HostVerdict);
          })()
        : (() => {
            const numeric = parseIPv4(address);
            return numeric === null
              ? ({ safe: false, reason: "resolved to an unparseable address" } as HostVerdict)
              : ipv4Verdict(numeric);
          })();

    if (!verdict.safe) {
      return { safe: false, reason: `${host} ${verdict.reason}` };
    }
  }

  return { safe: true };
}
