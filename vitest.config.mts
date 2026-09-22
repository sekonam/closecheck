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
    exclude: [...configDefaults.exclude, "**/.next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
