/** Vitest global setup: bundles dist/server.mjs once, for the tests of the download zip. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  const script = fileURLToPath(new URL("./build.ts", import.meta.url));
  execFileSync(process.execPath, [script], { stdio: "pipe" });
}
