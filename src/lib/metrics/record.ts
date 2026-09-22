import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";

/**
 * Product telemetry writers (docs/roadmap.md Phase 2.5, spec.md §11). metric_events/error_events
 * are write-only for the app role — closecheck_app (and closecheck_signup) hold INSERT and nothing
 * else (prisma/migrations/20260922090000), so:
 *
 * - Writes deliberately do NOT go through withOrgScope: these tables have no RLS and no org scoping;
 *   the isolation mechanism is the revoked SELECT, not row policies.
 * - Raw $executeRaw INSERTs, never prisma.metricEvent.create(): Prisma's create() emits
 *   INSERT ... RETURNING, and Postgres requires SELECT privilege to honor RETURNING — the same wall
 *   src/lib/actions/auth.ts documents for the signup role. Ids are generated in JS instead.
 * - Both helpers are fire-and-forget-safe: they catch everything internally and never throw into a
 *   caller — losing a telemetry row must never break a user-facing action. Call as
 *   `void recordMetric(...)` when you don't want to await the round trip.
 *
 * The read path is scripts/metrics-report.ts (DIRECT role) only.
 */

/** Any Prisma client/transaction that can run a raw statement — the shared app client by default;
 * signup passes signupPrisma (its role got the same INSERT-only grant). */
type RawCapableClient = { $executeRaw: typeof prisma.$executeRaw };

export type MetricType =
  | "org.signed_up"
  | "audit.created"
  | "audit.completed"
  | "report.generated"
  // Recorded when a consultant downloads a generated report — distinct from report.generated
  // because generating one and actually sending it to a buyer are different signals, and spec.md
  // §11's report-usage metric is about the second.
  | "report.exported"
  | "portal.viewed";

export async function recordMetric(
  type: MetricType,
  options: { orgId?: string; data?: Record<string, unknown>; client?: RawCapableClient } = {},
): Promise<void> {
  const { orgId, data, client = prisma } = options;
  try {
    await client.$executeRaw`
      INSERT INTO "metric_events" (id, "orgId", type, data, "createdAt")
      VALUES (${randomUUID()}, ${orgId ?? null}, ${type}, ${data ? JSON.stringify(data) : null}::jsonb, (now() AT TIME ZONE 'utc'))
    `;
  } catch (err) {
    // Telemetry loss is logged but never surfaced — see the module comment.
    console.error(`recordMetric(${type}) failed:`, err);
  }
}

export async function recordError(
  source: string,
  err: unknown,
  options: { orgId?: string; client?: RawCapableClient } = {},
): Promise<void> {
  const { orgId, client = prisma } = options;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? null) : null;
  console.error(`[${source}]`, err);
  try {
    await client.$executeRaw`
      INSERT INTO "error_events" (id, "orgId", source, message, stack, "createdAt")
      VALUES (${randomUUID()}, ${orgId ?? null}, ${source}, ${message.slice(0, 2000)}, ${stack}, (now() AT TIME ZONE 'utc'))
    `;
  } catch (insertErr) {
    console.error("recordError insert failed:", insertErr);
  }
}
