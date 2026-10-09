/**
 * Browser tests: the whole builder in Chromium against the demo package,
 * an in-memory database and a mail folder instead of SMTP (see
 * src/server/local-backends.ts). Run `pnpm test:e2e` (builds first).
 */
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env["E2E_PORT"] ?? 3917);
// A second server with two games, for switching the rules of a character (e2e/two-games.ts).
const TWO_GAMES_PORT = PORT + 1;
export const OUTBOX = fileURLToPath(new URL("./e2e/.outbox/", import.meta.url));
const DEMO = fileURLToPath(new URL("../../packages/demo-package/", import.meta.url));
const TWO_GAMES = fileURLToPath(new URL("./e2e/.two-games/", import.meta.url));

const serverEnv = (port: number, packages: string) => ({
  DATABASE_URL: "pglite:memory",
  PACKAGES_DIR: packages,
  MAIL_OUTBOX_DIR: OUTBOX,
  // The language model package names the address its program talks to.
  BASE_URL: `http://localhost:${port}`,
  NEXT_TELEMETRY_DISABLED: "1",
});

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
  },
  projects: [
    { name: "phone", testIgnore: /rules-step\.spec\.ts$/ },
    // Firefox handles clicks on nested cards its own way (AND-342): the click tests run there too.
    { name: "firefox", testMatch: /card-click\.spec\.ts/, use: { ...devices["Desktop Firefox"] } },
    {
      name: "two-games",
      testMatch: /rules-step\.spec\.ts$/,
      use: { baseURL: `http://localhost:${TWO_GAMES_PORT}` },
    },
  ],
  webServer: [
    {
      command: `next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      // E2E_PACKAGES_DIR runs the same tests against another package locally.
      env: serverEnv(PORT, process.env["E2E_PACKAGES_DIR"] ?? DEMO),
    },
    {
      command: `node e2e/two-games.ts && next start -p ${TWO_GAMES_PORT}`,
      url: `http://localhost:${TWO_GAMES_PORT}/api/health`,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      env: serverEnv(TWO_GAMES_PORT, TWO_GAMES),
    },
  ],
});
