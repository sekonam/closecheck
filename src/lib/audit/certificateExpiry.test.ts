import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drives the real `runSslCheck` through a mocked handshake.
 *
 * The previous suite re-implemented the runner's three rating lines as a local helper over the
 * exported constants — so it asserted the thresholds agreed with themselves and could not catch a
 * runner-side mistake. It passed throughout the period when a valid one-year certificate with
 * forty-five days to run was being rated Red.
 */
vi.mock("@/lib/checks/ssl", () => ({ fingerprintSsl: vi.fn() }));

import { fingerprintSsl } from "@/lib/checks/ssl";
import { runTierACheck } from "./tierA";

const sslMock = vi.mocked(fingerprintSsl);

/** A valid certificate of `lifetimeDays`, with `remainingDays` left to run. */
async function certificate(lifetimeDays: number, remainingDays: number) {
  const validTo = new Date(Date.now() + remainingDays * 86_400_000);
  const validFrom = new Date(validTo.getTime() - lifetimeDays * 86_400_000);
  sslMock.mockResolvedValue({
    valid: true,
    issuer: "Example CA",
    subject: "example.com",
    validFrom: validFrom.toUTCString(),
    validTo: validTo.toUTCString(),
    daysUntilExpiry: Math.floor(remainingDays),
    error: null,
  });
  return runTierACheck("ssl_cert", "example.com");
}

beforeEach(() => sslMock.mockReset());

describe("short-lived automated certificates", () => {
  it("treats two days left on a six-day certificate as healthy", async () => {
    // Template v4's rubric says so verbatim. A fixed 14/30-day rule rated this Red, and under
    // spec.md §6's worst-item rule that turned the whole audit Red for a target whose renewal is
    // working correctly — which teaches a consultant to distrust the check.
    expect((await certificate(6, 2)).severity).toBe("GREEN");
    expect((await certificate(90, 30.5)).severity).toBe("GREEN");
  });

  it("flags a short certificate that has genuinely missed its renewal", async () => {
    expect((await certificate(6, 1.5)).severity).toBe("YELLOW");
    expect((await certificate(6, 0.5)).severity).toBe("RED");
  });
});

describe("long-lived commercial certificates", () => {
  it("does not flag a one-year certificate a month out", async () => {
    // The inversion the proportional rule introduced. One third of 368 days is 122, so a valid
    // DigiCert certificate with 45 days to run rated Red — measured live on a real host. Every
    // commercial renewal process assumes thirty days is comfortable.
    for (const days of [45, 60, 90, 122]) {
      const result = await certificate(368, days);
      expect(result.severity, `${days} days left on a 1-year certificate`).toBe("GREEN");
    }
  });

  it("flags a one-year certificate only when it is actually close", async () => {
    expect((await certificate(368, 20)).severity).toBe("YELLOW");
    expect((await certificate(368, 10)).severity).toBe("RED");
  });

  it("applies the same day ceiling to a very long certificate", async () => {
    expect((await certificate(398, 300)).severity).toBe("GREEN");
    expect((await certificate(398, 40)).severity).toBe("GREEN");
    expect((await certificate(398, 5)).severity).toBe("RED");
  });
});

describe("certificates that failed validation", () => {
  it("rates a genuine certificate defect Red, with its real reason", async () => {
    for (const error of [
      "certificate has expired",
      "self-signed certificate in certificate chain",
      "unable to verify the first certificate",
      "Hostname/IP does not match certificate's altnames: Host: wrong.host.badssl.com",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    ]) {
      sslMock.mockResolvedValue({
        valid: false, issuer: null, subject: null, validFrom: null, validTo: null,
        daysUntilExpiry: null, error,
      });
      const result = await runTierACheck("ssl_cert", "example.com");
      expect(result.severity, error).toBe("RED");
      expect(result.note, error).toContain(error);
    }
  });

  it("does not call a transport or protocol failure a certificate defect", async () => {
    // These are the failure modes of the legacy servers this product's target businesses run, and
    // a loose keyword match rated every one of them Red — asserting a certificate defect that was
    // never observed. The last case is the sharpest: the word "certificate" was in the HOSTNAME.
    for (const error of [
      "error:0A000102:SSL routines::tlsv1 alert protocol version",
      "error:1408F10B:SSL routines:ssl3_get_record:wrong version number",
      "error:14094410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure",
      "getaddrinfo ENOTFOUND certificates.example.com",
      "connect ECONNREFUSED 127.0.0.1:443",
      "Not checked: localtest.me resolves into 127.0.0.0/8 (loopback)",
    ]) {
      sslMock.mockResolvedValue({
        valid: false, issuer: null, subject: null, validFrom: null, validTo: null,
        daysUntilExpiry: null, error,
      });
      const result = await runTierACheck("ssl_cert", "example.com");
      expect(result.severity, error).toBe("YELLOW");
      expect(result.note, error).toMatch(/could not complete a TLS check/i);
    }
  });

  it("rates an expired certificate Red even when the dates were readable", async () => {
    sslMock.mockResolvedValue({
      valid: true, issuer: "Example CA", subject: "example.com",
      validFrom: new Date(Date.now() - 400 * 86_400_000).toUTCString(),
      validTo: new Date(Date.now() - 5 * 86_400_000).toUTCString(),
      daysUntilExpiry: -5, error: null,
    });
    const result = await runTierACheck("ssl_cert", "example.com");
    expect(result.severity).toBe("RED");
    expect(result.note).toMatch(/expired on/i);
    expect(result.note).not.toMatch(/-\d+ day/);
  });
});
