import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { readPackageDir, type PackageFiles } from "./read.ts";
import { formatReport } from "./report.ts";
import { validatePackageDir, validatePackageFiles, type ValidationResult } from "./validate.ts";
import { formatVersionMismatch } from "./version.ts";

const DEMO = fileURLToPath(new URL("../../demo-package", import.meta.url));
const BROKEN = fileURLToPath(new URL("../test-fixtures/broken-package", import.meta.url));

// The demo package is the reference: every mutation below starts from it.
let demo: PackageFiles;
beforeAll(async () => {
  demo = (await readPackageDir(DEMO)).files;
});

/* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
type RawFiles = Map<string, any>;
function mutate(change: (files: RawFiles) => void): ValidationResult {
  const files = new Map([...demo].map(([k, v]) => [k, structuredClone(v)]));
  change(files);
  return validatePackageFiles(files);
}
const texts = (files: RawFiles, lang: string) => files.get(`texts/${lang}/core.json`).entries;
const thing = (files: RawFiles, file: string, id: string) =>
  files.get(`things/${file}.json`).find((t: any) => t.id === id);
/* eslint-enable @typescript-eslint/no-explicit-any */

const messages = (r: ValidationResult, level: "errors" | "warnings" = "errors") =>
  r[level].map((i) => `${i.file} ${i.path}: ${i.message}`);

describe("demo package", () => {
  it("passes validation without errors or warnings", async () => {
    const r = await validatePackageDir(DEMO);
    expect(messages(r)).toEqual([]);
    expect(messages(r, "warnings")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("covers the scope promised for the demo", async () => {
    const p = (await validatePackageDir(DEMO)).package!;
    const count = (kind: string) => p.things.filter((t) => t.kind === kind).length;
    expect(count("calling")).toBe(3);
    expect(count("path")).toBe(3);
    expect(count("folk")).toBe(3);
    expect(count("upbringing")).toBe(2);
    expect(count("knack")).toBe(20);
    expect(p.flow.level).toEqual({ min: 1, max: 3, default: 1 });
    expect(p.manifest.languages).toEqual(["de", "en"]);
    expect(new Set(p.flow.choices.map((c) => c.kind))).toEqual(
      new Set(["pickOne", "pickMany", "distribute", "number", "text", "info"]),
    );
  });

  it("records provenance for every text", async () => {
    const p = (await validatePackageDir(DEMO)).package!;
    expect(p.textOrigins.de!["item.fishing-net.name"]).toEqual({
      file: "texts/de/community.json",
      source: "mistland-community",
      license: "cc0",
    });
    expect(p.textOrigins.en!["package.name"]!.license).toBe("agpl");
  });
});

describe("broken package fixture", () => {
  it("fails with a readable message for every mistake", async () => {
    const r = await validatePackageDir(BROKEN);
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual([
      'manifest.json sources.lab.license: unknown license "mit" (known: cc0)',
      'values.json [1].formula: cannot read expression "floor(speed": expected ")" (at character 12)',
      "values.json : formulas depend on each other in a circle: speed → speed",
      "things/gadgets.json [0].stats.reach: 30 ft has no row in the ft→m table; add [30, …] to units.json",
      'things/gadgets.json [0].grants[0].choice: unknown choice "tune" (known: pick, name)',
      'texts/en/ gadget.whistle.name: missing text (name of thing "gadget.whistle")',
      'texts/en/ gadget.whistle.short: missing text (one-sentence summary of thing "gadget.whistle")',
      'texts/en/ gadget.whistle.explain.what: missing text (plain-language "what it is" of thing "gadget.whistle")',
      'texts/en/ gadget.whistle.explain.table: missing text (plain-language "at the table" of thing "gadget.whistle")',
    ]);
    expect(formatReport("broken", r)).toContain("FAILED  broken: 9 error(s), 0 warning(s)");
  });
});

describe("structure errors", () => {
  it("names the file and the field", () => {
    const r = mutate((f) => {
      f.get("flow.json").choices[0].kind = "pickSome";
      thing(f, "knacks", "knack.eddy").stats.reach = "far";
      f.get("manifest.json").extra = true;
    });
    expect(messages(r).join("\n")).toMatch(
      /flow\.json choices\[0\]\.kind: Invalid discriminator value\. Expected 'pickOne' \| 'pickMany'/,
    );
    expect(messages(r)).toContain(
      'things/knacks.json [8].stats.reach: must be a number, true/false, {"amount": n, "unit": "u"} or {"text": "text.key"}',
    );
    expect(messages(r)).toContain('manifest.json : Unrecognized key: "extra"');
  });

  it("reports a missing file", () => {
    const r = mutate((f) => f.delete("sheet.json"));
    expect(messages(r)).toEqual(["sheet.json : file is missing"]);
  });

  it("rejects badly formed keys", () => {
    const r = mutate((f) => {
      thing(f, "items", "item.rope").id = "Item Rope";
    });
    expect(messages(r)[0]).toMatch(/\.id: must be lowercase words/);
  });

  it("requires exactly one target per grant", () => {
    const r = mutate((f) => {
      thing(f, "items", "item.rope").grants = [{ thing: "item.mortar", choice: "gear" }];
    });
    expect(messages(r)).toContain(
      'things/items.json [3].grants[0]: a grant needs exactly one of "thing", "choice" or "value"',
    );
  });
});

describe("cross-file rules", () => {
  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "format version",
      (f) => (f.get("manifest.json").formatVersion = "0.2"),
      "manifest.json formatVersion: package is written for format 0.2, this builder understands 0.1",
    ],
    [
      "duplicate thing",
      (f) => f.get("things/community.json").push(structuredClone(thing(f, "items", "item.rope"))),
      'things/items.json [3].id: thing "item.rope" is declared twice (first in things/community.json [1])',
    ],
    [
      "unknown kind",
      (f) => (thing(f, "items", "item.rope").kind = "tool"),
      'things/items.json [3].kind: unknown kind "tool" (known: folk, upbringing, calling, path, talent, trait, knack, item)',
    ],
    [
      "unknown source",
      (f) => (thing(f, "items", "item.rope").source = "elsewhere"),
      'things/items.json [3].source: unknown source "elsewhere" (known: mistland, mistland-community)',
    ],
    [
      "reserved prefix",
      (f) => {
        thing(f, "items", "item.rope").id = "stat.rope";
      },
      'things/items.json [3].id: thing ids may not start with "stat."; that prefix is reserved for package texts',
    ],
    [
      "unknown value in expression",
      (f) => (f.get("values.json")[8].formula = "mightBonus * levle"),
      'values.json [8].formula: expression "mightBonus * levle" uses unknown value "levle"',
    ],
    [
      "has() of unknown thing",
      (f) => (thing(f, "callings-and-paths", "path.lightwarden").requires = "has('calling.lamp')"),
      `things/callings-and-paths.json [3].requires: expression "has('calling.lamp')" asks has("calling.lamp") but there is no such thing`,
    ],
    [
      "formula cycle across values",
      (f) => {
        f.get("values.json")[4].formula = "floor(stamina / 3)";
      },
      "values.json : formulas depend on each other in a circle: mightBonus → stamina → mightBonus",
    ],
    [
      "option source selects nothing",
      (f) => (f.get("flow.json").choices[0].options = { kind: "folk", tags: ["for-herbalist"] }),
      "flow.json choices[0].options: selects no things",
    ],
    [
      "recommendation outside the options",
      (f) => (f.get("flow.json").choices[0].recommend = [{ pick: ["calling.herbalist"] }]),
      'flow.json choices[0].recommend[0].pick[0]: "calling.herbalist" is not one of this choice\'s options',
    ],
    [
      "array method with wrong length",
      (f) =>
        (f.get("flow.json").choices.find((c: { id: string }) => c.id === "scores").methods[1].values = [
          9, 9,
        ]),
      "flow.json choices[12].methods[1].values: has 2 numbers for 4 targets",
    ],
    [
      "choice both fixed and granted",
      (f) => f.get("flow.json").steps.push({ id: "gear", choices: ["gear"] }),
      'flow.json steps[7].choices[0]: choice "gear" is granted by "calling.herbalist" and cannot also be a fixed step',
    ],
    [
      "card without layout",
      (f) => (thing(f, "items", "item.rope").card = true),
      'things/items.json [3].card: card is set, but sheet.json has no card layout for kind "item"',
    ],
    [
      "card field nobody has",
      (f) => (f.get("sheet.json").cards.knack.fields[3] = "colour"),
      'sheet.json cards.knack.fields[3]: no thing has a stat "colour"',
    ],
    [
      "language without unit defaults",
      (f) => delete f.get("units.json").languageDefaults.en,
      'units.json languageDefaults.en: no default length unit for language "en"',
    ],
    [
      "amount missing from a table without fallback",
      (f) => {
        delete f.get("units.json").conversions[1].fallback;
        thing(f, "items", "item.rope").stats.weight.amount = 11;
      },
      "things/items.json [3].stats.weight: 11 lb has no row in the lb→kg table; add [11, …] to units.json",
    ],
    [
      "missing translation",
      (f) => delete texts(f, "en")["knack.eddy.short"],
      'texts/en/ knack.eddy.short: missing text (one-sentence summary of thing "knack.eddy")',
    ],
    [
      "text defined twice",
      (f) => (f.get("texts/de/community.json").entries["package.name"] = "Doppelt"),
      'texts/de/core.json entries.package.name: text "package.name" is also defined in texts/de/community.json',
    ],
    [
      "unknown glossary link",
      (f) => (texts(f, "de")["knack.eddy.short"] = "Hält [[glossary:grip|fest]]."),
      'texts/de/core.json entries.knack.eddy.short: links unknown glossary entry "grip"',
    ],
    [
      "quantity placeholder without table row",
      (f) => {
        delete f.get("units.json").conversions[0].fallback;
        texts(f, "en")["knack.eddy.short"] = "Reaches {{length:45}}.";
      },
      "texts/en/core.json entries.knack.eddy.short: 45 ft has no row in the ft→m table; add [45, …] to units.json",
    ],
    [
      "suggestions must be a list",
      (f) => (texts(f, "de")["names.suggestions"] = "Mira"),
      "texts/de/core.json entries.names.suggestions: must be a list of strings",
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected);
  });
});

describe("warnings", () => {
  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "text marked missing",
      (f) => (texts(f, "en")["knack.eddy.explain.table"] = null),
      'texts/en/core.json entries.knack.eddy.explain.table: marked missing, not translated yet (plain-language "at the table" of thing "knack.eddy")',
    ],
    [
      "unused text",
      (f) => (texts(f, "de")["knack.old.name"] = "Alt"),
      "texts/de/core.json entries.knack.old.name: text is not used by anything in the package",
    ],
    [
      "unit written as plain text",
      (f) => (texts(f, "de")["knack.eddy.explain.what"] = "Wasser kreist bis 6 m weit."),
      "texts/de/core.json entries.knack.eddy.explain.what: states a unit as plain text; use a placeholder like {{length:30}} so it converts",
    ],
    [
      "different quantities across languages",
      (f) => (texts(f, "en")["knack.eddy.explain.what"] = "Water swirls up to {{length:30}} away."),
      "texts/ knack.eddy.explain.what: languages state different quantities (de: length:20; en: length:30)",
    ],
    [
      "name too long",
      (f) => (texts(f, "de")["knack.eddy.name"] = "Ein sehr langer Name für einen Kniff"),
      "texts/de/core.json entries.knack.eddy.name: is 36 characters long; the style limit is 30",
    ],
    [
      "choice never asked",
      (f) => f.get("flow.json").steps.splice(6, 1),
      'flow.json choices[14]: choice "name" is never asked: no step lists it and no thing grants it',
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(true);
    expect(messages(r, "warnings")).toContain(expected);
  });
});

describe("SPEC.md", () => {
  it("contains a minimal package that passes validation", () => {
    const spec = readFileSync(new URL("../SPEC.md", import.meta.url), "utf8");
    const section = spec.slice(spec.indexOf("## 16."), spec.indexOf("## 17."));
    const files: PackageFiles = new Map();
    for (const m of section.matchAll(/^`([^`]+\.json)`\n\n```json\n([\s\S]*?)\n```/gm)) {
      files.set(m[1]!, JSON.parse(m[2]!));
    }
    expect(files.size).toBe(7);
    const r = validatePackageFiles(files);
    expect(messages(r)).toEqual([]);
    expect(messages(r, "warnings")).toEqual([]);
  });
});

describe("formatVersionMismatch", () => {
  it("accepts the same version and rejects other 0.x minors and majors", () => {
    expect(formatVersionMismatch("0.1", "0.1")).toBeUndefined();
    expect(formatVersionMismatch("0.2", "0.1")).toMatch(/understands 0.1/);
    expect(formatVersionMismatch("0.1", "0.2")).toMatch(/understands 0.2/);
    expect(formatVersionMismatch("1.0", "1.2")).toBeUndefined();
    expect(formatVersionMismatch("1.3", "1.2")).toMatch(/understands 1.2/);
    expect(formatVersionMismatch("2.0", "1.2")).toMatch(/major versions differ/);
  });
});
