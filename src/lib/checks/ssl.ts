import { connect } from "node:tls";

import { assertPublicHost } from "@/lib/net/hostSafety";

export interface SslFingerprint {
  valid: boolean;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
  error: string | null;
}

const UNREACHABLE: SslFingerprint = {
  valid: false,
  issuer: null,
  subject: null,
  validFrom: null,
  validTo: null,
  daysUntilExpiry: null,
  error: null,
};

export async function fingerprintSsl(hostname: string, timeoutMs = 8000): Promise<SslFingerprint> {
  // The host guard the other Tier A checks go through, which this one did not. `tls.connect` is
  // not `fetch`, so it never passed through safeFetch — and an adversarial run confirmed the gap
  // empirically: pointed at a host resolving to 127.0.0.1, every other check correctly refused
  // while this one dialled 127.0.0.1:443 and reported what answered. A TLS handshake against an
  // internal service is a port scanner with a certificate reader attached, and the issuer and
  // subject it reads come straight back into the finding.
  const verdict = await assertPublicHost(hostname);
  if (!verdict.safe) {
    return { ...UNREACHABLE, error: `Not checked: ${verdict.reason}` };
  }

  return new Promise((resolve) => {
    const socket = connect(
      {
        host: hostname,
        port: 443,
        servername: hostname, // SNI — required for most modern hosts to present the right cert
        timeout: timeoutMs,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          const authorized = socket.authorized;
          socket.end();

          if (!cert || Object.keys(cert).length === 0) {
            resolve({
              valid: false,
              issuer: null,
              subject: null,
              validFrom: null,
              validTo: null,
              daysUntilExpiry: null,
              error: "No certificate presented",
            });
            return;
          }

          const validTo = new Date(cert.valid_to);
          const daysUntilExpiry = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);

          const firstString = (v: string | string[] | undefined): string | null =>
            Array.isArray(v) ? v[0] ?? null : v ?? null;

          resolve({
            valid: authorized,
            issuer: firstString(cert.issuer?.O) ?? firstString(cert.issuer?.CN),
            subject: firstString(cert.subject?.CN),
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            daysUntilExpiry,
            error: authorized ? null : "Certificate not trusted by default CA store",
          });
        } catch (err) {
          resolve({
            valid: false,
            issuer: null,
            subject: null,
            validFrom: null,
            validTo: null,
            daysUntilExpiry: null,
            error: err instanceof Error ? err.message : "Certificate parse failed",
          });
        }
      },
    );

    socket.on("error", (err) => {
      resolve({
        valid: false,
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        daysUntilExpiry: null,
        error: err.message,
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        valid: false,
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        daysUntilExpiry: null,
        error: "Connection timed out",
      });
    });
  });
}
