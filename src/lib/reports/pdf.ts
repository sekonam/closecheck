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

/** Page margins. Non-zero on every side for two reasons: content printed to the physical paper edge
 * is cut off by most office printers, and Chromium draws the running header/footer INSIDE the top
 * and bottom margin boxes — with the previous `0` margins there was physically nowhere for them to
 * go, which is why `displayHeaderFooter` would have done nothing even if it had been enabled. Top
 * and bottom are deeper than the sides to hold the header/footer band; the horizontal 14mm matches
 * the `padding: 0 14mm` the header/footer templates in renderHtml.ts use, so the running chrome
 * lines up with the body text rather than floating a few millimetres off it. */
const PAGE_MARGIN = { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" };

/** Total budget for launching a browser, loading the document and producing the PDF. Without this,
 * a Chromium that hangs on `setContent` (a malformed data: URI, an exhausted sandbox) hangs the
 * server action that called it forever; a failed report generation is recoverable, a wedged request
 * is not. Generous because a cold Chromium start on a small instance is genuinely slow. */
const RENDER_TIMEOUT_MS = 45_000;
const LAUNCH_TIMEOUT_MS = 30_000;
const SET_CONTENT_TIMEOUT_MS = 20_000;

/**
 * Chromium's `headerTemplate`/`footerTemplate` are rendered in their own isolated context, outside
 * the document — so they cannot be produced by the document's own markup, but they are absolutely
 * part of what the report *looks like* (firm name, brand accent and page numbers on every page).
 * renderReportHtml therefore emits them as inert <template> elements and this lifts them back out,
 * keeping one module responsible for the document's appearance rather than splitting the whitelabel
 * treatment across two files that must be kept in sync by hand.
 *
 * A plain regex, not a DOM parse: the input is markup this codebase generated one function call
 * earlier, with a known, fixed id, and pulling in a parser to read it would be the more fragile
 * choice. If the marker is absent (any other HTML handed to this function), the caller falls back
 * to no running chrome rather than failing.
 */
export function extractPdfChrome(html: string): { header: string | null; footer: string | null } {
  const lift = (id: string): string | null => {
    const match = new RegExp(`<template id="${id}">([\\s\\S]*?)</template>`).exec(html);
    return match ? match[1].trim() : null;
  };
  return { header: lift("closecheck-pdf-header"), footer: lift("closecheck-pdf-footer") };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  const { header, footer } = extractPdfChrome(html);

  const browser = await chromium
    .launch({ executablePath, headless: true, timeout: LAUNCH_TIMEOUT_MS })
    .catch((err) => {
      throw new Error(
        `Could not launch Chromium for PDF rendering (${err instanceof Error ? err.message : err}). ` +
          `Run "npx playwright install chromium", or set PLAYWRIGHT_CHROMIUM_PATH to a system Chrome/Chromium binary in .env.`,
      );
    });

  try {
    return await withTimeout(
      (async () => {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load", timeout: SET_CONTENT_TIMEOUT_MS });
        return page.pdf({
          format: "A4",
          printBackground: true,
          margin: PAGE_MARGIN,
          // Only enabled when the document actually supplied chrome: Chromium's DEFAULT templates
          // (page title + URL, in a size nobody can read) on a whitelabeled client deliverable
          // would be worse than nothing.
          displayHeaderFooter: Boolean(header || footer),
          // An empty string is not "no template" to Chromium — it falls back to its default. A
          // single empty div is how you say "draw nothing here".
          headerTemplate: header ?? "<div></div>",
          footerTemplate: footer ?? "<div></div>",
        });
      })(),
      RENDER_TIMEOUT_MS,
      "PDF rendering",
    );
  } finally {
    // Always, including on timeout: a browser process leaked per failed report would exhaust the
    // host long before anyone noticed the failures themselves. Deliberately no browser reuse across
    // calls for the same reason — a pooled browser that dies (OOM, crashed renderer) turns one
    // failed report into every subsequent report failing, and a cold start per report is the
    // cheaper problem.
    await browser.close().catch(() => {});
  }
}
