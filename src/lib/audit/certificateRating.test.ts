import { describe, expect, it } from "vitest";

import { certificateLifetimeRemaining, __domainStatusInternals } from "./tierA";

const { isCertificateVerdict } = __domainStatusInternals;

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
