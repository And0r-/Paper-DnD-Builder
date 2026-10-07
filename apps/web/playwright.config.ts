/**
 * Browser tests: the whole builder in Chromium against the demo package,
 * an in-memory database and a mail folder instead of SMTP (see
 * src/server/local-backends.ts). Run `pnpm test:e2e` (builds first).
 */
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env["E2E_PORT"] ?? 3917);
export const OUTBOX = fileURLToPath(new URL("./e2e/.outbox/", import.meta.url));
const DEMO = fileURLToPath(new URL("../../packages/demo-package/", import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "de-DE",
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
    // Chromium for every project; the phone size comes from the device above.
    browserName: "chromium",
    // A UTF-8 locale for the browser: without one Chromium saves "Ausführlich.pdf" as "download".
    launchOptions: { env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
  },
  projects: [{ name: "phone" }],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    env: {
      DATABASE_URL: "pglite:memory",
      // E2E_PACKAGES_DIR runs the same tests against another package locally.
      PACKAGES_DIR: process.env["E2E_PACKAGES_DIR"] ?? DEMO,
      MAIL_OUTBOX_DIR: OUTBOX,
      // The language model package names the address its program talks to.
      BASE_URL: `http://localhost:${PORT}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
