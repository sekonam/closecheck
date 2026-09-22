/**
 * Next.js instrumentation hook (stable since Next 15 — no config flag needed): installs
 * process-level last-resort error capture for Phase 2.5's error tracking
 * (docs/roadmap.md Phase 2.5). Server-action failures are already recorded at the
 * runOrRedirect chokepoint (src/lib/actions/errorRedirect.ts); this catches what escapes
 * everything else — unhandled rejections and uncaught exceptions.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // register() can run more than once across dev recompiles — never stack duplicate handlers.
  const globalFlag = globalThis as unknown as { __closecheckProcessHandlers?: boolean };
  if (globalFlag.__closecheckProcessHandlers) return;
  globalFlag.__closecheckProcessHandlers = true;

  const { recordError } = await import("@/lib/metrics/record");

  process.on("unhandledRejection", (reason) => {
    // Recording is itself fire-and-forget-safe; the process keeps serving.
    void recordError("process:unhandledRejection", reason);
  });

  process.on("uncaughtException", (err) => {
    // Node's guidance stands: an uncaught exception leaves the process in undefined state, so exit
    // after a short flush window for the telemetry insert rather than limping on. The platform
    // (Render/Docker) restarts the service.
    void recordError("process:uncaughtException", err);
    setTimeout(() => process.exit(1), 250);
  });
}
