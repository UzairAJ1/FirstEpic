import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One shared local database: run files one at a time.
    fileParallelism: false,
    globalSetup: ["./src/global-setup.ts"],
    setupFiles: ["./src/leak-scan.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
