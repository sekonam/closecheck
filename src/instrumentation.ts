/**
 * Next.js instrumentation hook (stable since Next 15 — no config flag needed): installs
 * process-level last-resort error capture for Phase 2.5's error tracking
 * (docs/roadmap.md Phase 2.5). Server-action failures are already recorded at the
 * runOrRedirect chokepoint (src/lib/actions/errorRedirect.ts); this catches what escapes
 * everything else — unhandled rejections and uncaught exceptions.
 *
 * The actual process.on calls live in instrumentation.node.ts behind this dynamic import: a static
 * import would put Node-only APIs into the edge bundle, which the bundler rejects even though the
 * guard below means they'd never run there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installProcessHandlers } = await import("./instrumentation.node");
  installProcessHandlers();
}
