import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { validateExtensionFiles, versionAccepts, type ExtensionBase } from "./extension.ts";
import { readPackageDir, type PackageFiles } from "./read.ts";
import { validatePackageDir, validatePackageFiles } from "./validate.ts";

const DEMO = fileURLToPath(new URL("../../demo-package", import.meta.url));
const TIDES = fileURLToPath(new URL("../../demo-package/extensions/demo-tides", import.meta.url));

let base: ExtensionBase;
let tides: PackageFiles;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO);
  base = { files: r.files!, package: r.package!, warnings: r.warnings };
  tides = (await readPackageDir(TIDES)).files;
});

/* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
function mutate(change: (files: Map<string, any>) => void) {
  const files = new Map([...tides].map(([k, v]) => [k, structuredClone(v)]));
  change(files);
  return validateExtensionFiles(base, files);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const errors = (r: { errors: { file: string; path: string; message: string }[] }) =>
  r.errors.map((i) => `${i.file} ${i.path}: ${i.message}`);

describe("demo extension", () => {
  it("is valid with its base and adds its things after the base's", () => {
    const r = validateExtensionFiles(base, tides);
    expect(errors(r)).toEqual([]);
    expect(r.warnings.map((w) => w.message)).toEqual([
      "1 text(s) of the extension are missing in de and are shown in en",
    ]);
    const ids = r.package!.things.map((t) => t.id);
    expect(ids.slice(-2)).toEqual(["path.tide-warden", "talent.tide-reading"]);
    expect(ids.slice(0, -2)).toEqual(base.package.things.map((t) => t.id));
    expect(r.package!.manifest.id).toBe("demo");
    expect(r.package!.values.at(-1)!.id).toBe("tideReadingRoll");
  });

  it("keeps what it knows about the extension", () => {
    const x = validateExtensionFiles(base, tides).extension!;
    expect(x).toMatchObject({
      id: "demo-tides",
      version: "0.1.0",
      languages: ["en", "de"],
      publishable: false,
      name: { de: "Gezeiten im Nebelland", en: "Tides of Mistland" },
      things: ["path.tide-warden", "talent.tide-reading"],
      choices: [],
    });
  });

  it("takes a text a language lacks from the fallback language and marks it", () => {
    const p = validateExtensionFiles(base, tides).package!;
    expect(p.texts["de"]!["path.tide-warden.rules"]).toBe(p.texts["en"]!["path.tide-warden.rules"]);
    expect(p.textOrigins["de"]!["path.tide-warden.rules"]).toMatchObject({
      fallbackFrom: "en",
      file: "demo-tides/texts/en/tides.json",
      license: "example-closed",
    });
    expect(p.textOrigins["de"]!["path.tide-warden.name"]!.fallbackFrom).toBeUndefined();
    // The extension's own name is not a text of the package.
    expect(p.texts["de"]!["package.name"]).toBe(base.package.texts["de"]!["package.name"]);
  });

  it("leaves the base alone", () => {
    const before = base.package.things.length;
    validateExtensionFiles(base, tides);
    expect(base.package.things.length).toBe(before);
    expect(base.package.extensions).toBeUndefined();
    expect(base.package.texts["de"]!["path.tide-warden.name"]).toBeUndefined();
  });

  it("can be the base of a second extension", () => {
    const first = validateExtensionFiles(base, tides);
    const second = new Map(tides);
    const m = structuredClone(tides.get("manifest.json")) as { id: string };
    m.id = "demo-reeds";
    second.set("manifest.json", m);
    second.set("things/tides.json", [
      {
        id: "talent.reed-weaving",
        kind: "talent",
        source: "tides",
        stats: { roll: { value: "tideReadingRoll" } },
      },
    ]);
    second.delete("values.json");
    second.set("texts/en/tides.json", {
      source: "tides",
      entries: {
        "package.name": "Reeds",
        "package.short": "One talent.",
        "talent.reed-weaving.name": "Reed Weaving",
        "talent.reed-weaving.short": "You weave baskets.",
        "talent.reed-weaving.explain.what": "Reeds bend for you.",
        "talent.reed-weaving.explain.table": "You make a basket.",
      },
    });
    second.delete("texts/de/tides.json");
    second.set("manifest.json", { ...m, languages: ["en"] });
    const r = validateExtensionFiles(
      { files: first.files!, package: first.package!, warnings: first.warnings },
      second,
    );
    expect(errors(r)).toEqual([]);
    expect(r.package!.extensions!.map((x) => x.id)).toEqual(["demo-tides", "demo-reeds"]);
    expect(r.package!.textOrigins["de"]!["talent.reed-weaving.name"]!.fallbackFrom).toBe("en");
  });
});

describe("an extension is refused", () => {
  it("when it declares a key of the base", () => {
    const r = mutate((f) => (f.get("things/tides.json")[0].id = "path.ferrymaster"));
    expect(errors(r)).toContain(
      'things/tides.json [0].id: thing "path.ferrymaster" is already in "demo"; an extension may only add new keys',
    );
  });

  it("when it overwrites a text of the base", () => {
    const r = mutate((f) => (f.get("texts/en/tides.json").entries["path.ferrymaster.name"] = "Mine"));
    expect(errors(r)).toContain(
      'texts/en/tides.json entries.path.ferrymaster.name: text "path.ferrymaster.name" is already in "demo"; an extension may only add new keys',
    );
  });

  it("when a table by level does not fit the base's levels", () => {
    const r = mutate((f) => f.get("values.json").push({ id: "tideDice", source: "tides", byLevel: [1, 2] }));
    expect(errors(r)).toContain("values.json [1].byLevel: has 2 numbers, but levels 1 to 20 need 20");
  });

  it("when it names something neither it nor the base has, in its own file", () => {
    const r = mutate((f) => f.get("things/tides.json")[0].grants.push({ thing: "talent.nowhere" }));
    expect(errors(r).join("\n")).toMatch(
      /^things\/tides\.json \[0\]\.grants\[2\]\.thing: .*talent\.nowhere/m,
    );
  });

  it("when its base is another package, too old, or it brings units", () => {
    expect(errors(mutate((f) => (f.get("manifest.json").dependsOn[0].id = "other")))).toEqual([
      'manifest.json dependsOn[0].id: this extension builds on "other", not on "demo"',
    ]);
    expect(errors(mutate((f) => (f.get("manifest.json").dependsOn[0].minVersion = "0.20.0")))).toEqual([
      'manifest.json dependsOn[0].minVersion: needs "demo" 0.20.0 or a later version with the same major version; found 0.19.0',
    ]);
    expect(errors(mutate((f) => f.set("units.json", base.files.get("units.json"))))).toEqual([
      "units.json : an extension uses the units of its base; remove this file",
    ]);
  });

  it("when a required text is missing in its fallback language", () => {
    const r = mutate((f) => delete f.get("texts/en/tides.json").entries["talent.tide-reading.short"]);
    expect(errors(r).join("\n")).toMatch(/talent\.tide-reading\.short: missing text/);
  });

  it("when it is validated alone, as a package", () => {
    const r = validatePackageFiles(tides);
    expect(r.ok).toBe(false);
  });
});

describe("versionAccepts", () => {
  it("wants the same major version and at least the minimum", () => {
    expect(versionAccepts("0.18.0", "0.18.0")).toBe(true);
    expect(versionAccepts("0.18.3", "0.18.0")).toBe(true);
    expect(versionAccepts("0.19.0", "0.18.5")).toBe(true);
    expect(versionAccepts("0.17.9", "0.18.0")).toBe(false);
    expect(versionAccepts("1.0.0", "0.18.0")).toBe(false);
  });
});
