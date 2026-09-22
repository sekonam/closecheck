import { describe, expect, it } from "vitest";

import { ALLOWED_LOGO_MIME_TYPES, logoContentTypeFor } from "./logoContentType";

describe("logoContentTypeFor", () => {
  it("resolves the formats a brand mark actually arrives as", () => {
    expect(logoContentTypeFor("org/branding/logo-mark.png")).toBe("image/png");
    expect(logoContentTypeFor("logo.JPG")).toBe("image/jpeg");
    expect(logoContentTypeFor("logo.jpeg")).toBe("image/jpeg");
    expect(logoContentTypeFor("logo.gif")).toBe("image/gif");
    expect(logoContentTypeFor("logo.webp")).toBe("image/webp");
  });

  it("refuses SVG, whatever it is called", () => {
    // The whole reason this is an allowlist. An SVG is a document that can carry script; serving one
    // with an image type that a browser will render as markup is the finding this forecloses.
    expect(logoContentTypeFor("logo.svg")).toBeNull();
    expect(logoContentTypeFor("logo.SVG")).toBeNull();
    expect(logoContentTypeFor("logo.svgz")).toBeNull();
  });

  it("refuses anything else, including no extension and a double extension", () => {
    for (const key of ["logo", "logo.html", "logo.php", "logo.png.html", "", "logo."]) {
      expect(logoContentTypeFor(key), key).toBeNull();
    }
  });

  it("takes the LAST extension, which is the one a server would act on", () => {
    expect(logoContentTypeFor("logo.html.png")).toBe("image/png");
    expect(logoContentTypeFor("logo.png.svg")).toBeNull();
  });

  it("handles a null key", () => {
    expect(logoContentTypeFor(null)).toBeNull();
  });

  it("keeps the accepted upload types and the servable types describing one set of formats", () => {
    // They drifted apart as separate literals before this module existed: the upload allowlist and
    // the serving map were edited independently, so a format could be accepted and then served as
    // application/octet-stream, or vice versa.
    expect([...ALLOWED_LOGO_MIME_TYPES].sort()).toEqual(
      ["image/gif", "image/jpeg", "image/png", "image/webp"],
    );
    for (const type of ALLOWED_LOGO_MIME_TYPES) {
      expect(
        ["png", "jpg", "jpeg", "gif", "webp"].some((ext) => logoContentTypeFor(`x.${ext}`) === type),
        type,
      ).toBe(true);
    }
  });
});
