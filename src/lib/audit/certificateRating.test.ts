import { describe, expect, it } from "vitest";

import { __domainStatusInternals, certificateLifetimeRemaining } from "./tierA";

const { isCertificateVerdict, CERT_RENEWAL_FRACTION, CERT_OVERDUE_FRACTION, CERT_FRACTION_TOLERANCE } =
  __domainStatusInternals;

/** The rating the runner applies, so boundary cases are tested the way they are actually judged. */
function rating(fraction: number): "green" | "yellow" | "red" {
  if (fraction < CERT_OVERDUE_FRACTION - CERT_FRACTION_TOLERANCE) return "red";
  if (fraction < CERT_RENEWAL_FRACTION - CERT_FRACTION_TOLERANCE) return "yellow";
  return "green";
}

/** A certificate issued `lifetimeDays` ago-to-now such that `remainingDays` are left. */
function cert(lifetimeDays: number, remainingDays: number) {
  const to = new Date(Date.now() + remainingDays * 86_400_000);
  const from = new Date(to.getTime() - lifetimeDays * 86_400_000);
  return certificateLifetimeRemaining(from.toISOString(), to.toISOString());
}

describe("certificate lifetime, not day counts", () => {
  it("treats two days left on a six-day certificate as healthy", () => {
    // Template v4's own rubric says so verbatim. The runner's previous fixed 14/30-day rule rated
    // this Red — and under spec.md §6's worst-item rule that turned the whole audit Red for a
    // target whose renewal is correctly automated.
    // Exactly one third — the healthiest possible state, a renewal running precisely on schedule.
    // Without a tolerance it lands a hair below the line on floating-point alone and rates Yellow.
    expect(rating(cert(6, 2)!.fraction)).toBe("green");
    expect(rating(cert(90, 30)!.fraction)).toBe("green");
  });

  it("treats 60 days left on a 200-day certificate as past the renewal line", () => {
    // The rubric's own worked example: roughly 67 days on a 200-day certificate is the one-third
    // point. The fixed rule rated this Green.
    expect(rating(cert(200, 60)!.fraction)).toBe("yellow");
    expect(rating(cert(200, 66)!.fraction)).toBe("yellow");
  });

  it("does not flag a long-dated pre-2026 certificate with most of its life left", () => {
    expect(rating(cert(398, 300)!.fraction)).toBe("green");
  });

  it("calls renewal overdue below one sixth of lifetime", () => {
    expect(rating(cert(90, 10)!.fraction)).toBe("red");
    expect(rating(cert(6, 0.5)!.fraction)).toBe("red");
  });

  it("reports the certificate's real lifetime, so the note can state it", () => {
    expect(cert(90, 30)!.lifetimeDays).toBe(90);
    expect(cert(200, 60)!.lifetimeDays).toBe(200);
  });

  it("returns null when lifetime cannot be computed rather than guessing", () => {
    expect(certificateLifetimeRemaining(null, "Nov 29 23:59:59 2026 GMT")).toBeNull();
    expect(certificateLifetimeRemaining("not a date", "also not")).toBeNull();
    // An end date at or before the start date is nonsense, not a zero-length lifetime.
    expect(certificateLifetimeRemaining("2026-05-01T00:00:00Z", "2026-05-01T00:00:00Z")).toBeNull();
  });

  it("parses the OpenSSL date format Node actually returns", () => {
    const remaining = certificateLifetimeRemaining(
      "Sep  1 00:00:00 2026 GMT",
      "Nov 29 23:59:59 2026 GMT",
    );
    expect(remaining).not.toBeNull();
    expect(remaining!.lifetimeDays).toBe(90);
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
