import { describe, expect, it } from "vitest";

import { UNTRUSTED_CONTENT_CSP, fileResponseHeaders } from "./fileResponseHeaders";

/**
 * The point of this module is that three protections cannot be forgotten by a new route, because
 * forgetting them is exactly what happened: the logo route shipped without any of them while the
 * other three had all three, and each route's headers looked deliberate on its own.
 */
describe("invariants no caller can opt out of", () => {
  const everyShape = [
    { contentType: "application/pdf", disposition: "inline" as const },
    { contentType: "application/octet-stream", disposition: "attachment" as const, filename: "x.bin" },
    { contentType: "image/png", disposition: "inline" as const, filename: "logo.png" },
    { contentType: "application/pdf", disposition: "attachment" as const, cacheExtra: "must-revalidate" },
    { contentType: "text/plain", disposition: "attachment" as const, csp: UNTRUSTED_CONTENT_CSP },
  ];

  it("always sets nosniff", () => {
    for (const shape of everyShape) {
      expect(fileResponseHeaders(shape)["X-Content-Type-Options"], shape.contentType).toBe("nosniff");
    }
  });

  it("always keeps the response out of a shared cache", () => {
    for (const shape of everyShape) {
      // `private` is the load-bearing word: no-store alone still permits a shared cache to have
      // held it on the way past, and a revocable portal link's copy would outlive its revocation.
      expect(fileResponseHeaders(shape)["Cache-Control"]).toMatch(/^private, no-store/);
    }
  });

  it("always keeps it out of a search index", () => {
    for (const shape of everyShape) {
      expect(fileResponseHeaders(shape)["X-Robots-Tag"]).toBe("noindex, nofollow");
    }
  });
});

describe("what legitimately varies", () => {
  it("appends extra cache directives after the mandatory ones", () => {
    expect(
      fileResponseHeaders({ contentType: "application/pdf", disposition: "inline", cacheExtra: "must-revalidate" })[
        "Cache-Control"
      ],
    ).toBe("private, no-store, must-revalidate");
  });

  it("carries an RFC 5987 filename alongside the ASCII one", () => {
    expect(
      fileResponseHeaders({
        contentType: "application/octet-stream",
        disposition: "attachment",
        filename: "contract.pdf",
        filenameEncoded: "contrat%20sign%C3%A9.pdf",
      })["Content-Disposition"],
    ).toBe(`attachment; filename="contract.pdf"; filename*=UTF-8''contrat%20sign%C3%A9.pdf`);
  });

  it("omits the filename entirely when none is given", () => {
    // The portal route withholds it on purpose: a filename is one more place a target business's
    // name could land in a downloads folder or a mail client.
    expect(
      fileResponseHeaders({ contentType: "application/pdf", disposition: "inline" })["Content-Disposition"],
    ).toBe("inline");
  });

  it("sets a content-security policy only when one is asked for", () => {
    expect(
      fileResponseHeaders({ contentType: "application/pdf", disposition: "inline" })["Content-Security-Policy"],
    ).toBeUndefined();
    expect(
      fileResponseHeaders({ contentType: "text/plain", disposition: "attachment", csp: UNTRUSTED_CONTENT_CSP })[
        "Content-Security-Policy"
      ],
    ).toBe("default-src 'none'; sandbox");
  });

  it("does not default the sandbox policy on", () => {
    // `sandbox` is what would break the PDF the portal deliberately renders inline for the buyer.
    // A default that both deliverable-serving routes have to switch off is not a default, and the
    // failure it would cause is the buyer seeing a blank viewer.
    expect(UNTRUSTED_CONTENT_CSP).toContain("sandbox");
    expect(
      fileResponseHeaders({ contentType: "application/pdf", disposition: "inline" }),
    ).not.toHaveProperty("Content-Security-Policy");
  });
});
