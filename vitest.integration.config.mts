import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration suite — separate from the default `npm test` unit run on purpose.
 *
 * These tests need a live Postgres (DATABASE_URL / DIRECT_DATABASE_URL) and, for the HTTP ones, a
 * running app server. The unit suite must stay runnable with neither, so integration specs use the
 * `.itest.ts` suffix, which vitest's default `include` glob does not match — that keeps the two
 * suites separated without editing the shared vitest.config.mts.
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    // The E2E production build (NEXT_DIST_DIR=.next-e2e) copies the source tree, tests included,
    // into its standalone output; without this the suite runs twice.
    exclude: ["**/node_modules/**", "**/.next/**", "**/.next-e2e/**"],
    environment: "node",
    include: ["tests/integration/**/*.itest.ts"],
    setupFiles: ["tests/integration/helpers/loadEnv.ts"],
    // Fixtures create and drop real rows in shared tables; parallel files would race on cleanup.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
