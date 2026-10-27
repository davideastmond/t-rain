import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Test runner config (see TEST_PLAN.md §0). The `@/` alias mirrors
// tsconfig.json so tests import source exactly the way the app does.
// Environment defaults to node: most of the suite is pure engine/net
// logic. Component tests opt into jsdom per file with a
// `// @vitest-environment jsdom` comment instead.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
