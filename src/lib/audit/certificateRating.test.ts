import { describe, expect, it } from "vitest";

import { certificateLifetimeRemaining, __domainStatusInternals } from "./tierA";

const { isCertificateVerdict } = __domainStatusInternals;

describe("certificateLifetimeRemaining", () => {
  it("parses the OpenSSL date format Node actually returns", () => {
    // `tls.getPeerCertificate` returns "Nov 29 23:59:59 2026 GMT", not ISO — and the whole
    // proportional rating depends on this parsing, so a silent null here would send every
    // certificate down the unknown-lifetime path and stop the rating working at all.
    const remaining = certificateLifetimeRemaining(
      "Sep  1 00:00:00 2026 GMT",
      "Nov 29 23:59:59 2026 GMT",
    );
    expect(remaining).not.toBeNull();
    expect(remaining!.lifetimeDays).toBe(90);
  });

  it("reports the certificate's real lifetime, so the note can state it", () => {
    const to = new Date(Date.now() + 30 * 86_400_000);
    const from = new Date(to.getTime() - 200 * 86_400_000);
    expect(certificateLifetimeRemaining(from.toISOString(), to.toISOString())!.lifetimeDays).toBe(200);
  });

  it("returns null when lifetime cannot be computed rather than guessing", () => {
    expect(certificateLifetimeRemaining(null, "Nov 29 23:59:59 2026 GMT")).toBeNull();
    expect(certificateLifetimeRemaining("not a date", "also not")).toBeNull();
    // An end at or before the start is nonsense, not a zero-length lifetime — dividing by it would
    // produce Infinity and rate every such certificate Green.
    expect(certificateLifetimeRemaining("2026-05-01T00:00:00Z", "2026-05-01T00:00:00Z")).toBeNull();
    expect(certificateLifetimeRemaining("2026-06-01T00:00:00Z", "2026-05-01T00:00:00Z")).toBeNull();
  });
});

describe("telling a certificate verdict from a transport failure", () => {
  it("treats validation failures as verdicts", () => {
    // These come back with the same null certificate fields as a DNS failure, so the reason is the
    // only thing distinguishing them — and getting it wrong in the safe-looking direction would
    // downgrade a genuinely expired certificate to "we couldn't check".
    for (const error of [
      "certificate has expired",
      "self-signed certificate in certificate chain",
      "unable to verify the first certificate",
      "Hostname/IP does not match certificate's altnames: Host: wrong.host.badssl.com",
      "CERT_HAS_EXPIRED",
    ]) {
      expect(isCertificateVerdict(error), error).toBe(true);
    }
  });

  it("treats connection failures and refusals as transport problems", () => {
    for (const error of [
      "getaddrinfo ENOTFOUND no-such-domain-zzq-19472.com",
      "connect ECONNREFUSED 127.0.0.1:443",
      "Connection timed out",
      "Not checked: localtest.me resolves into 127.0.0.0/8 (loopback)",
      null,
    ]) {
      expect(isCertificateVerdict(error), String(error)).toBe(false);
    }
  });
});
