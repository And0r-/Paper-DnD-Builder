import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { healthReport } from "./health.ts";
import { loadPackages, type PackageRegistry } from "./packages/loader.ts";

const quiet = { info: () => {}, error: () => {} };

const TIDES = path.join(DEMO_PACKAGE_DIR, "extensions", "demo-tides");
const manifestOf = async (dir: string) => JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));

describe("healthReport", () => {
  it("names each loaded package and extension with its version and format version", async () => {
    const [demo, tides] = await Promise.all([manifestOf(DEMO_PACKAGE_DIR), manifestOf(TIDES)]);
    const report = healthReport(await loadPackages(DEMO_PACKAGE_DIR, quiet));
    expect(report).toEqual({
      status: "ok",
      packages: [
        { id: "demo", version: demo.version, formatVersion: demo.formatVersion, kind: "base" },
        {
          id: "demo-tides",
          version: tides.version,
          formatVersion: tides.formatVersion,
          kind: "extension",
          extends: "demo",
        },
      ],
      warnings: [],
    });
  });

  it("lists two bases and an extension side by side in a packages folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "health-"));
    try {
      const noExtensions = (from: string) => (src: string) =>
        !src.includes("node_modules") && !src.startsWith(path.join(from, "extensions"));
      await cp(DEMO_PACKAGE_DIR, path.join(root, "demo"), {
        recursive: true,
        filter: noExtensions(DEMO_PACKAGE_DIR),
      });
      const second = path.join(root, "demo-second");
      await cp(DEMO_PACKAGE_DIR, second, { recursive: true, filter: noExtensions(DEMO_PACKAGE_DIR) });
      await writeFile(
        path.join(second, "manifest.json"),
        JSON.stringify({ ...(await manifestOf(second)), id: "demo-second" }),
      );
      await cp(TIDES, path.join(root, "demo-tides"), { recursive: true });

      const report = healthReport(await loadPackages(root, quiet));
      expect(report.packages.map((p) => [p.id, p.kind, p.kind === "extension" ? p.extends : null])).toEqual([
        ["demo", "base", null],
        ["demo-second", "base", null],
        ["demo-tides", "extension", "demo"],
      ]);
      expect(report.warnings).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
      extensions: new Map(),
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
