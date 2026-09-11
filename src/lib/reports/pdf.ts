import { chromium } from "playwright";

/**
 * Renders a self-contained HTML string (src/lib/reports/renderHtml.ts) to a PDF buffer.
 *
 * Named as one of the two build-risk areas in docs/research/build.md §1/§7 (alongside RLS
 * correctness) — "getting a whitelabeled, multi-page PDF to a genuinely client-ready visual bar."
 * `page.setContent` + `page.pdf()` avoids the fragility of fetching an authenticated route over HTTP
 * from inside the same process; the HTML is generated in-process and handed to Chromium directly.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` overrides the executable — needed in sandboxed environments where
 * `npx playwright install chromium` cannot fetch a browser binary (see .env.example). Leave it unset
 * in a normal dev machine or CI/production once `playwright install chromium` has been run there.
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

  const browser = await chromium.launch({ executablePath, headless: true }).catch((err) => {
    throw new Error(
      `Could not launch Chromium for PDF rendering (${err instanceof Error ? err.message : err}). ` +
        `Run "npx playwright install chromium", or set PLAYWRIGHT_CHROMIUM_PATH to a system Chrome/Chromium binary in .env.`,
    );
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
