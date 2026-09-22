import { recordError } from "@/lib/metrics/record";

/**
 * Node-runtime half of src/instrumentation.ts — a separate module, dynamically imported behind the
 * NEXT_RUNTIME guard, so the edge bundle never statically contains `process.on` (the bundler
 * analyzes static imports per-runtime regardless of runtime guards around the call sites).
 */
export function installProcessHandlers(): void {
  // register() can run more than once across dev recompiles — never stack duplicate handlers.
  const globalFlag = globalThis as unknown as { __closecheckProcessHandlers?: boolean };
  if (globalFlag.__closecheckProcessHandlers) return;
  globalFlag.__closecheckProcessHandlers = true;

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
