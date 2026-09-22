import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckMethod, Severity, Tier } from "@prisma/client";

import { renderReportHtml } from "@/lib/reports/renderHtml";

import {
  EIGHT_COLUMNS,
  FOUR_COLUMNS,
  REGISTER_SHAPES,
  finding,
  poisonedReport,
  registerReport,
  report,
  type Col,
} from "../fixtures/reportRegisters";
import { launchBrowser } from "./helpers/browser";

// ---------------------------------------------------------------------------
// The report document, measured in a real layout engine.
//
// The unit suite next to renderHtml.ts reasons about the widths the HTML declares. This runs the
// document through the engine that actually produces the PDF and measures where the glyphs land —
// the only way to catch the defect that prompted it: a cell drawn on top of its neighbour is
// invisible to every string assertion, because both strings are present and correct.
//
// It lives in the integration lane rather than beside the renderer because the unit suite's
// contract is that it runs with nothing installed — no database, no server, no browser, in about a
// second. A browser breaks that contract, which is why these assertions originally reached for
// `describe.skipIf` and then silently measured nothing everywhere the environment variable was
// unset, CI included. The skip was a symptom of a test in the wrong lane, not a policy failure.
// ---------------------------------------------------------------------------


/**
 * Measured in the page, as a string rather than a function: vitest compiles this file with esbuild,
 * which rewrites every function literal to reference a `__name` helper that does not exist inside
 * the browser context.
 *
 * Returns, for the whole document: cells whose text is painted outside their own content box (the
 * overprinting defect), words broken across lines inside a table header, values in an atomic
 * column that had to wrap at all, and the text layer as the page presents it.
 */
const MEASURE = `(() => {
  const overflowing = [];
  const splitHeaderWords = [];
  const wrappedAtomicValues = [];
  const ATOMIC = /^(-?\\$[\\d,.]+|\\d{4}-\\d{2}-\\d{2}|[\\d.]+%)$/;

  for (const cell of document.querySelectorAll("td,th")) {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const rects = [...range.getClientRects()];
    if (rects.length === 0) continue;

    const box = cell.getBoundingClientRect();
    const style = getComputedStyle(cell);
    // Every table in this document sets border-collapse: collapse, and a collapsed border is drawn
    // half inside the cell box and half outside it — so only half of it comes off the content box.
    // Counting the whole of the 4px severity rail reports a 2px underflow on a cell that is fine.
    const half = getComputedStyle(cell.closest("table")).borderCollapse === "collapse" ? 0.5 : 1;
    const right = box.right - parseFloat(style.paddingRight) - half * parseFloat(style.borderRightWidth);
    const left = box.left + parseFloat(style.paddingLeft) + half * parseFloat(style.borderLeftWidth);
    const over = Math.max(...rects.map((r) => r.right)) - right;
    const under = left - Math.min(...rects.map((r) => r.left));
    const text = (cell.textContent || "").trim();
    if (over > 1 || under > 1) {
      overflowing.push(text.slice(0, 40) + " [+" + Math.max(over, under).toFixed(1) + "px]");
    }

    // Lines, not rects: a value carrying <wbr> break opportunities is several text nodes and so
    // several rects even when it sits on one line, sometimes a fraction of a pixel apart. A real
    // second line is a whole line-height away.
    const tops = rects.map((r) => r.top);
    if (ATOMIC.test(text) && Math.max(...tops) - Math.min(...tops) > 3) wrappedAtomicValues.push(text);
    if (cell.tagName !== "TH") continue;

    // A header word split across two lines shows up as a word-range with two client rects.
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      const words = /[^\\s]+/g;
      let match;
      while ((match = words.exec(value))) {
        if (match[0].length < 2) continue;
        const wordRange = document.createRange();
        wordRange.setStart(node, match.index);
        wordRange.setEnd(node, match.index + match[0].length);
        if (wordRange.getClientRects().length > 1) splitHeaderWords.push(match[0]);
      }
    }
  }

  const fieldTable = [...document.querySelectorAll("table")].find(
    (t) => t.style.marginTop === "4px" && t.querySelector("thead")
  );

  return {
    overflowing,
    splitHeaderWords: [...new Set(splitHeaderWords)],
    wrappedAtomicValues: [...new Set(wrappedAtomicValues)],
    fieldTableWidth: fieldTable ? +fieldTable.getBoundingClientRect().width.toFixed(1) : null,
    text: document.body.innerText,
  };
})()`;

describe("the document as Chromium actually lays it out", () => {
  let browser: Browser;

  beforeAll(async () => {
    // launchBrowser() throws with an actionable message rather than skipping, so a missing browser
    // is a failure here. That is the whole reason this block lives in this lane.
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function measure(html: string) {
    const page = await browser.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      // A4 (210mm) less pdf.ts's 14mm margins, at 96dpi — the width the document is paginated at.
      await page.setViewportSize({ width: 688, height: 1400 });
      await page.setContent(html, { waitUntil: "load" });
      return (await page.evaluate(MEASURE)) as {
        overflowing: string[];
        splitHeaderWords: string[];
        wrappedAtomicValues: string[];
        fieldTableWidth: number | null;
        text: string;
      };
    } finally {
      await page.close();
    }
  }

  it("confirms the width a structured table is laid out in", async () => {
    // FIELD_TABLE_PX above is arithmetic from the A4 page box; this is the number itself.
    const measured = await measure(renderReportHtml(registerReport(FOUR_COLUMNS)));
    expect(measured.fieldTableWidth).toBeGreaterThan(504);
    expect(measured.fieldTableWidth).toBeLessThan(516);
  }, 60_000);

  it.each(REGISTER_SHAPES)("paints no cell of a %s-column register over its neighbour", async (_shape, columns) => {
    // The defect itself, measured where it happens. Before the column sizing this reported every
    // money and date cell in the six- and eight-column registers, overflowing by 20-42px each.
    const measured = await measure(renderReportHtml(registerReport(columns)));
    expect(measured.overflowing).toEqual([]);
  }, 60_000);

  it.each(REGISTER_SHAPES)("breaks no column label of a %s-column register mid-word", async (_shape, columns) => {
    // "MONT"/"HLY COST" and "ANNU"/"AL COST", read off a rendered page.
    const measured = await measure(renderReportHtml(registerReport(columns)));
    expect(measured.splitHeaderWords).toEqual([]);
  }, 60_000);

  it.each(REGISTER_SHAPES.slice(0, 2))(
    "puts every money and date value of a %s-column register on one line",
    async (_shape, columns) => {
      const measured = await measure(renderReportHtml(registerReport(columns)));
      expect(measured.wrappedAtomicValues).toEqual([]);
    },
    60_000,
  );

  it("keeps every value in the text layer, including beside a 600-character token", async () => {
    // What `table-layout: fixed` was bought for, and what none of the above may trade away: the
    // original defect clipped other findings' columns out of the PDF's text layer entirely.
    const measured = await measure(renderReportHtml(poisonedReport()));
    for (const expected of ["Vendor 1", "$176.00", "2027-02-11", "owner@seller.example"]) {
      expect(measured.text).toContain(expected);
    }
    expect(measured.text).toContain("A".repeat(60));
  }, 60_000);

  it("draws a bright brand accent as the firm's own colour", async () => {
    // #ffe600 came back #a69600 and printed an olive-gold document. The accent reaches the page
    // unchanged now, and the text on top of it still flips to dark — which is what makes that safe.
    const html = renderReportHtml(
      report({
        org: { name: "Yellow Brand LLP", brandColorHex: "#ffe600", brandLogoDataUri: null },
        findings: [finding({ severity: Severity.RED, status: "FAIL" })],
      }),
    );
    expect(html).toContain("background:#ffe600");
    expect(html).not.toContain("#a69600");
    const measured = await measure(html);
    expect(measured.overflowing).toEqual([]);
  }, 60_000);
});
