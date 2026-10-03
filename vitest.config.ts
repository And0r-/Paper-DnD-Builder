import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.ts", "apps/*/app/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
