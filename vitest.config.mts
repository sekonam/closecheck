import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    // `next build` with output:"standalone" copies the whole source tree — test files included —
    // into .next/standalone, where vitest's default include glob happily finds them and runs them
    // a second time against the copied node_modules. That copy is incomplete (playwright-core's
    // browsers.json is not carried over), so pdf.test.ts fails there while passing in src/. The
    // failure has nothing to do with the code under test; the build output simply is not source.
    // The policy watch is excluded here and run as its own scheduled job (vitest.policy-watch.
    // config.mts, and the `policy-watch` job in .github/workflows/ci.yml). It asserts that
    // externally-owned facts — card-network thresholds, an undated ICANN revision — have been
    // re-verified by a date, so it goes red on a calendar day with no code change. That is the
    // point of it, and it is also why it must not gate pull requests: a check that turns someone
    // else's unrelated push red is a check that gets deleted, and deleting it leaves nothing.
    // Excluded by glob rather than by skipping, so it can never report green without running.
    exclude: [...configDefaults.exclude, "**/.next/**", "**/policyWatch*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
