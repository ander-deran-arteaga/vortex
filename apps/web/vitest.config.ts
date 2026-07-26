import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // esbuild handles the TSX transform; the app's tsconfig uses jsx: "preserve"
  // for Next, so the automatic runtime is selected here for tests only.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    /*
      Sits above the 10s asyncUtilTimeout in tests/setup.ts so a slow async
      assertion reports its own failure instead of being killed mid-wait by the
      runner. Vitest's 5s default was below the async budget these tests need
      when `pnpm test` runs four workspaces concurrently.
    */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
