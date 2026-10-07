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
    // server.mjs for the MCP download, built once like the web build does.
    globalSetup: ["packages/mcp/scripts/test-setup.ts"],
    // Password hashing and the in-process database are slow when every file runs in parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
