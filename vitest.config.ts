import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "apps/*/app/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "packages/*/designs/**/*.test.{ts,tsx}",
    ],
    environment: "node",
    // One worker per core (~500 MB each) ran the shared dev container out of memory next to
    // the e2e server and the browser. Two forks keep a full run well under a gigabyte.
    pool: "forks",
    maxWorkers: 2,
    // server.mjs for the MCP download, built once like the web build does.
    globalSetup: ["packages/mcp/scripts/test-setup.ts"],
    // Password hashing and the in-process database are slow when every file runs in parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
