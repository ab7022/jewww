import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    // Server tests talk to a real local MongoDB; they share a database name per file
    // so parallel files cannot clobber each other's fixtures.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
