import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { healthReport } from "./health.ts";
import { loadPackages, type PackageRegistry } from "./packages/loader.ts";

const quiet = { info: () => {}, error: () => {} };

describe("healthReport", () => {
  it("names each loaded package with its version and format version", async () => {
    const manifest = JSON.parse(await readFile(path.join(DEMO_PACKAGE_DIR, "manifest.json"), "utf8"));
    const report = healthReport(await loadPackages(DEMO_PACKAGE_DIR, quiet));
    expect(report).toEqual({
      status: "ok",
      packages: [{ id: "demo", version: manifest.version, formatVersion: manifest.formatVersion }],
      warnings: [],
    });
  });

  it("stays ok without packages and says so in warnings", async () => {
    const report = healthReport(await loadPackages(undefined, quiet));
    expect(report.status).toBe("ok");
    expect(report.packages).toEqual([]);
    expect(report.warnings).toEqual(["No content package is loaded."]);
  });

  it("names a rejected package by its folder, not its full path", () => {
    const registry: PackageRegistry = {
      packages: new Map(),
      rejected: [{ dir: "/srv/packages/broken", report: "manifest.json: missing" }],
      get: () => undefined,
    };
    expect(healthReport(registry).warnings).toEqual([
      'Package folder "broken" was rejected. See the log.',
      "No content package is loaded.",
    ]);
  });

  it("reports a failed start without failing itself", () => {
    const report = healthReport(undefined);
    expect(report.status).toBe("ok");
    expect(report.packages).toEqual([]);
    expect(report.warnings).toHaveLength(1);
  });
});
