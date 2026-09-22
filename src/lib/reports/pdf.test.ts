import { describe, expect, it } from "vitest";
import { extractPdfChrome } from "./pdf";
import { renderReportHtml } from "./renderHtml";

describe("extractPdfChrome", () => {
  it("lifts the running header and footer out of a rendered report", () => {
    const html = renderReportHtml({
      businessName: "Harbour Street Bistro",
      templateName: "Restaurant — v3",
      generatedAt: new Date("2026-09-22T10:00:00Z"),
      org: { name: "Meridian Diligence", brandColorHex: "#0d7a6f", brandLogoDataUri: null },
      findings: [],
    });

    const { header, footer } = extractPdfChrome(html);
    expect(header).toContain("Meridian Diligence");
    expect(header).toContain("#0d7a6f");
    // Chromium ignores the document stylesheet in these templates and defaults to an unreadable
    // font size, so an explicit one is load-bearing, not styling preference.
    expect(header).toContain("font-size:8px");
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
    // The <template> wrapper itself must not survive: Chromium renders the string it is given.
    expect(header).not.toContain("<template");
    expect(footer).not.toContain("</template>");
  });

  it("returns nulls for HTML that carries no chrome, so the caller can skip displayHeaderFooter", () => {
    expect(extractPdfChrome("<html><body>hello</body></html>")).toEqual({ header: null, footer: null });
  });
});
