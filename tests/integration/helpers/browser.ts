import { chromium, type Browser, type Locator, type Page } from "playwright";
import { BASE_URL, serverIsReachable } from "./http";

/**
 * Shared browser helpers for the integration suite.
 *
 * Extracted so there is one implementation of the waiting rules rather than one per spec file.
 * These rules are not obvious and each of them cost a real debugging session to find, so a second
 * copy that drifts from this one would reintroduce failures that look like product bugs.
 */

/**
 * Launches Chromium, failing loudly rather than skipping when it cannot.
 *
 * A browser suite that quietly skips when PLAYWRIGHT_CHROMIUM_PATH is wrong, or when no browser is
 * installed, reports success having asserted nothing — the same failure the Stripe suite had, where
 * a launch gate cited a file that executed zero assertions on every run. If these tests cannot run,
 * that is a result, not a non-event.
 */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  } catch (err) {
    throw new Error(
      `Could not launch Chromium, so the browser suite cannot verify anything. Run ` +
        `\`npx playwright install chromium\`, or set PLAYWRIGHT_CHROMIUM_PATH to a system browser ` +
        `(see .env.example). Refusing to skip. Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Asserts a server is actually there, for the same reason: an unreachable server must fail, not skip. */
export async function requireServer(): Promise<void> {
  if (!(await serverIsReachable())) {
    throw new Error(
      `No app server answering at ${BASE_URL}. Start one (\`npm run dev\`) or set ` +
        `CLOSECHECK_TEST_BASE_URL. Refusing to skip — a browser suite that skips silently is ` +
        `indistinguishable from one that passes.`,
    );
  }
}

/**
 * Clicks a server-action submit button and waits for the action's own POST to come back.
 *
 * Neither obvious wait works. A server action re-renders in place rather than navigating, so a
 * load-state wait never fires for it — and waiting for network idle is actively useless under
 * `next dev`, where the HMR websocket means the network never goes idle: it either times out after
 * 30 seconds or resolves at an arbitrary unrelated moment. That produced the same spec passing and
 * failing on alternate runs against unchanged code.
 *
 * Worse, navigating away before the action completes CANCELS it. "Click save, then go to the page,
 * then assert" therefore cancels the save, and the page correctly shows nothing saved — which
 * presents as a persistence bug in code that is working perfectly.
 *
 * Waiting on the POST response is the only signal that actually means "the action finished". Only
 * after this resolves is it safe to navigate and assert persistence against a fresh load.
 */
export async function submitAndSettle(page: Page, locator: Locator): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST", { timeout: 30_000 }),
    locator.click(),
  ]);
}

/**
 * For an action expected to be REFUSED. A rejection redirects rather than re-rendering, so the
 * completion signal is the error URL, and waiting on a POST would race it.
 */
export async function submitExpectingRefusal(page: Page, locator: Locator): Promise<void> {
  await Promise.all([
    page.waitForURL(/[?&]error=/, { timeout: 30_000 }),
    locator.click(),
  ]);
}

/**
 * Collects console and page errors for assertion at the end of a run. A page that renders but logs
 * a hydration or server-action error is broken in a way no status-code assertion can see.
 *
 * Filters only genuinely ambient noise — Next's dev overlay, extensions, sourcemaps — and nothing
 * that could be an application failure.
 */
export function collectPageErrors(page: Page): { errors: string[]; significant: () => string[] } {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return {
    errors,
    significant: () =>
      errors.filter(
        (message) => !/favicon|DevTools|Download the React DevTools|Extension|sourcemap/i.test(message),
      ),
  };
}
