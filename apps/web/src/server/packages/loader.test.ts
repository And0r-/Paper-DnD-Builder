import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPackages } from "./loader.ts";

const BROKEN = fileURLToPath(
  new URL("../../../../../packages/format/test-fixtures/broken-package/", import.meta.url),
);

let root: string;
let log: { info: string[]; error: string[] };
const logger = () => ({ info: (m: string) => log.info.push(m), error: (m: string) => log.error.push(m) });

/** Copies a package; without its `extensions/` folder unless asked. */
async function copyPackage(from: string, name: string, withExtensions = false): Promise<string> {
  const to = path.join(root, name);
  await cp(from, to, {
    recursive: true,
    filter: (src) =>
      !src.includes("node_modules") && (withExtensions || !src.startsWith(path.join(from, "extensions"))),
  });
  return to;
}
const TIDES = path.join(DEMO_PACKAGE_DIR, "extensions", "demo-tides");

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "packages-"));
  log = { info: [], error: [] };
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("loadPackages", () => {
  it("loads every valid package in the directory", async () => {
    await copyPackage(DEMO_PACKAGE_DIR, "demo");
    const reg = await loadPackages(root, logger());
    expect([...reg.packages.keys()]).toEqual(["demo"]);
    expect(reg.get("demo")?.manifest.version).toBe("0.19.0");
    expect(reg.rejected).toEqual([]);
    expect(log.info.join("\n")).toContain("1 loaded, 0 rejected");
  });

  it("rejects invalid packages with the validator's report and keeps going", async () => {
    await copyPackage(DEMO_PACKAGE_DIR, "demo");
    await copyPackage(BROKEN, "broken");
    const notJson = await copyPackage(DEMO_PACKAGE_DIR, "not-json");
    await writeFile(path.join(notJson, "values.json"), "[ this is not json");
    await mkdir(path.join(root, "just-a-folder"));

    const reg = await loadPackages(root, logger());

    expect([...reg.packages.keys()]).toEqual(["demo"]);
    expect(reg.rejected.map((r) => path.basename(r.dir))).toEqual(["broken", "not-json"]);
    expect(reg.rejected[0]!.report).toMatch(/^error/m);
    expect(reg.rejected[0]!.report).toContain("FAILED");
    expect(reg.rejected[1]!.report).toContain("values.json");
    expect(reg.rejected[1]!.report).toContain("not valid JSON");
    expect(log.error.join("\n")).toContain("REJECTED");
    expect(log.info.at(-1)).toBe("Packages: 1 loaded, 2 rejected.");
  });

  it("keeps the first of two packages with the same id", async () => {
    await copyPackage(DEMO_PACKAGE_DIR, "a-demo");
    await copyPackage(DEMO_PACKAGE_DIR, "b-demo-copy");
    const reg = await loadPackages(root, logger());
    expect(reg.packages.get("demo")!.dir).toBe(path.join(root, "a-demo"));
    expect(reg.rejected[0]!.report).toContain('two packages have the id "demo"');
  });

  it("accepts a directory that is itself a package", async () => {
    const reg = await loadPackages(DEMO_PACKAGE_DIR, logger());
    expect([...reg.packages.keys()]).toEqual(["demo"]);
  });

  it("loads an extension next to its base or in its extensions folder, and puts them together", async () => {
    await copyPackage(DEMO_PACKAGE_DIR, "demo", true);
    const reg = await loadPackages(root, logger());
    expect([...reg.extensions.keys()]).toEqual(["demo-tides"]);
    expect(reg.extensions.get("demo-tides")).toMatchObject({ base: "demo", info: { publishable: false } });
    const has = (key: string, thing: string) => reg.get(key)!.things.some((t) => t.id === thing);
    expect(has("demo+demo-tides", "path.tide-warden")).toBe(true);
    expect(has("demo", "path.tide-warden")).toBe(false);
    expect(reg.get("demo+demo-tides")).toBe(reg.get("demo+demo-tides"));
    expect(reg.get("demo+nothing")).toBeUndefined();
    expect(log.info.at(-1)).toBe("Packages: 1 loaded (and 1 extension(s)), 0 rejected.");

    await rm(path.join(root, "demo", "extensions"), { recursive: true });
    await copyPackage(TIDES, "demo-tides");
    expect([...(await loadPackages(root, logger())).extensions.keys()]).toEqual(["demo-tides"]);
  });

  it("rejects an extension that does not fit, and the base runs on", async () => {
    await copyPackage(DEMO_PACKAGE_DIR, "demo");
    const ext = await copyPackage(TIDES, "demo-tides");
    const things = JSON.parse(await readFile(path.join(ext, "things/tides.json"), "utf8"));
    things[0].id = "path.ferrymaster";
    await writeFile(path.join(ext, "things/tides.json"), JSON.stringify(things));
    const reg = await loadPackages(root, logger());
    expect([...reg.packages.keys()]).toEqual(["demo"]);
    expect(reg.extensions.size).toBe(0);
    expect(reg.rejected[0]!.report).toContain('thing "path.ferrymaster" is already in "demo"');
    expect(log.error.join("\n")).toContain("REJECTED");
    expect(reg.get("demo+demo-tides")).toBeUndefined();
  });

  it("rejects an extension whose base is missing, or a second one that clashes with the first", async () => {
    await copyPackage(TIDES, "demo-tides");
    expect((await loadPackages(root, logger())).rejected[0]!.report).toContain(
      'needs the package "demo", which is not loaded',
    );
    await copyPackage(DEMO_PACKAGE_DIR, "demo");
    const twin = await copyPackage(TIDES, "demo-tides-twin");
    const manifest = JSON.parse(await readFile(path.join(twin, "manifest.json"), "utf8"));
    await writeFile(path.join(twin, "manifest.json"), JSON.stringify({ ...manifest, id: "demo-twin" }));
    const reg = await loadPackages(root, logger());
    expect([...reg.extensions.keys()]).toEqual(["demo-tides"]);
    expect(reg.rejected.map((r) => r.report)).toEqual([
      expect.stringContaining("does not fit together with demo-tides"),
    ]);
  });

  it("starts without packages, and says why, when the directory is missing, empty or not set", async () => {
    expect((await loadPackages(path.join(root, "missing"), logger())).packages.size).toBe(0);
    expect((await loadPackages(root, logger())).packages.size).toBe(0);
    expect((await loadPackages(undefined, logger())).packages.size).toBe(0);
    expect(log.error).toEqual([
      expect.stringContaining("cannot read PACKAGES_DIR"),
      expect.stringContaining("no package found"),
      expect.stringContaining("PACKAGES_DIR is not set"),
    ]);
  });

  it("picks up a swapped package on the next start, no rebuild", async () => {
    const dir = await copyPackage(DEMO_PACKAGE_DIR, "demo");
    expect((await loadPackages(root, logger())).get("demo")!.manifest.version).toBe("0.19.0");
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ ...manifest, version: "0.6.1" }));
    expect((await loadPackages(root, logger())).get("demo")!.manifest.version).toBe("0.6.1");
  });
});
