import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The policy watch, run on a schedule rather than on every push.
 *
 * These tests assert that facts this product does not own — card-network thresholds, certificate
 * lifetime schedules, an ICANN revision adopted with no effective date — have been re-verified by a
 * date. They therefore go red on a calendar day with nobody having changed any code, which is
 * exactly what makes them the answer to "who remembers to check", and exactly why they cannot gate
 * pull requests: a check that turns an unrelated push red gets deleted, and deleting it leaves the
 * note it replaced.
 *
 * Run with: npm run test:policy-watch
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/policyWatch*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
