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
const knacksSection = (files: RawFiles) =>
  files.get("sheet.json").sections.find((s: any) => s.id === "knacks");
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
    expect(count("knack")).toBe(29);
    expect(count("boon")).toBe(7);
    expect(p.flow.level).toEqual({
      min: 1,
      max: 20,
      default: 1,
      tracks: { choice: "calling", addRequiresCurrent: true },
    });
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
      'things/knacks.json [8].stats.reach: must be a number, true/false, {"amount": n, "unit": "u"}, {"text": "text.key", "vars"?: {…}, "variants"?: […]} or {"value": "valueKey"}',
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
      (f) => (f.get("manifest.json").formatVersion = "0.3"),
      "manifest.json formatVersion: package is written for format 0.3, this builder understands 0.22",
    ],
    [
      "duplicate thing",
      (f) => f.get("things/community.json").push(structuredClone(thing(f, "items", "item.rope"))),
      'things/items.json [3].id: thing "item.rope" is declared twice (first in things/community.json [1])',
    ],
    [
      "unknown kind",
      (f) => (thing(f, "items", "item.rope").kind = "tool"),
      'things/items.json [3].kind: unknown kind "tool" (known: folk, upbringing, calling, path, talent, trait, knack, item, …)',
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
      (f) => (f.get("values.json")[16].formula = "mightBonus * levle"),
      'values.json [16].formula: expression "mightBonus * levle" uses unknown value "levle"',
    ],
    [
      "has() of unknown thing",
      (f) => (thing(f, "callings-and-paths", "path.lightwarden").requires = "has('calling.lamp')"),
      `things/callings-and-paths.json [3].requires: expression "has('calling.lamp')" asks has("calling.lamp") but there is no such thing`,
    ],
    [
      "formula cycle across values",
      (f) => {
        f.get("values.json")[12].formula = "floor(stamina / 3)";
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
      "badge outside the options",
      (f) => f.get("flow.json").choices[2].badges[0].things.push("folk.moorfolk"),
      'flow.json choices[2].badges[0].things[1]: "folk.moorfolk" is not one of this choice\'s options',
    ],
    [
      "two badges on one thing",
      (f) =>
        f.get("flow.json").choices[2].badges.push({
          things: ["calling.lantern-bearer"],
          text: "choice.calling.badge.gentle",
        }),
      'flow.json choices[2].badges[1].things[0]: "calling.lantern-bearer" already has a badge in this choice',
    ],
    [
      "badge without text",
      (f) => delete texts(f, "de")["choice.calling.badge.gentle"],
      'texts/de/ choice.calling.badge.gentle: missing text (badge of choice "calling")',
    ],
    [
      "about an unknown thing",
      (f) => (f.get("things/handling.json")[0].about = "item.lantern"),
      'things/handling.json [0].about: unknown thing "item.lantern"',
    ],
    [
      "about itself",
      (f) => (f.get("things/handling.json")[0].about = "handling.lantern-staff"),
      "things/handling.json [0].about: a thing cannot be about itself",
    ],
    [
      "held on options that are about nothing",
      (f) => (f.get("flow.json").choices[2].held = { text: "choice.calling.badge.gentle" }),
      'flow.json choices[2].held: none of this choice\'s options is "about" another thing',
    ],
    [
      "held without text",
      (f) => delete texts(f, "en")["choice.handling-river-runner.held"],
      'texts/en/ choice.handling-river-runner.held: missing text (line naming what the character has, in choice "handling-river-runner")',
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
      'flow.json steps[16].choices[0]: choice "gear" is granted by "calling.herbalist" and cannot also be a fixed step',
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
      "use boxes from a stat nobody has",
      (f) => (f.get("sheet.json").cards.knack.uses = "charges"),
      'sheet.json cards.knack.uses: no thing has a stat "charges"',
    ],
    [
      "use boxes from a stat the selected things lack",
      (f) => (f.get("sheet.json").sections.find((s: { id: string }) => s.id === "knacks").uses = "weight"),
      'sheet.json sections[8].uses: none of the things selected here has a stat "weight"',
    ],
    [
      "use boxes from a quantity",
      (f) => (thing(f, "talents-and-traits", "trait.stone-steady").stats.uses = { amount: 5, unit: "ft" }),
      'things/talents-and-traits.json [10].stats.uses: sections[7].uses draws use boxes from this stat; it must be a whole number ≥ 0, {"text": …} or {"value": …}',
    ],
    [
      "use boxes from a fraction",
      (f) => (thing(f, "knacks", "knack.spark-shower").stats.uses = 1.5),
      'things/knacks.json [0].stats.uses: sections[8].uses draws use boxes from this stat; it must be a whole number ≥ 0, {"text": …} or {"value": …}',
    ],
    [
      "check list note from true/false",
      (f) => (thing(f, "talents-and-traits", "talent.climbing").stats.score = true),
      "things/talents-and-traits.json [0].stats.score: sections[4].note prints this stat next to the name; it cannot be true/false",
    ],
    [
      "check list note from a stat nobody has",
      (f) => (f.get("sheet.json").sections.find((s: { id: string }) => s.id === "talents").note = "basis"),
      'sheet.json sections[4].note: no thing has a stat "basis"',
    ],
    [
      "check list total from a text",
      (f) => (thing(f, "talents-and-traits", "talent.climbing").stats.roll = { text: "value.might.name" }),
      'things/talents-and-traits.json [0].stats.roll: sections[4].total prints the character\'s value in the box; this stat must be {"value": …}',
    ],
    [
      "table column from a stat nobody has",
      (f) =>
        (f.get("sheet.json").sections.find((s: { id: string }) => s.id === "attacks").columns[2].stat =
          "colour"),
      'sheet.json sections[5].columns[2].stat: no thing has a stat "colour"',
    ],
    [
      "table column from true/false",
      (f) => (thing(f, "items", "item.sling").stats.range = true),
      "things/items.json [10].stats.range: sections[5].columns[2].stat prints this stat in a table column; it cannot be true/false",
    ],
    [
      "stat text filled from an unknown value",
      (f) => (thing(f, "items", "item.sling").stats.harm.vars.bonus = "slingPower"),
      'things/items.json [10].stats.harm.vars.bonus: unknown value "slingPower"',
    ],
    [
      "stat text with a variable no stat supplies",
      (f) => (f.get("texts/de/core.json").entries["stat-value.item.sling.harm"] = "1W4 {{var:power|signed}}"),
      'texts/de/core.json entries.stat-value.item.sling.harm: uses {{var:power}}, but no stat with this text supplies "power"',
    ],
    [
      "section condition on an unknown value",
      (f) => (f.get("sheet.json").sections.find((s: { id: string }) => s.id === "path").when = "glow > 0"),
      'sheet.json sections[11].when: expression "glow > 0" uses unknown value "glow"',
    ],
    [
      "section condition that does not parse",
      (f) => (f.get("sheet.json").sections.find((s: { id: string }) => s.id === "path").when = "level >="),
      'sheet.json sections[11].when: cannot read expression "level >=": unexpected end of expression (at character 9)',
    ],
    [
      "box condition on an unknown thing",
      (f) => (f.get("sheet.json").sections[1].boxes[0].when = "has('calling.lamplighter')"),
      `sheet.json sections[1].boxes[0].when: expression "has('calling.lamplighter')" asks has("calling.lamplighter") but there is no such thing`,
    ],
    [
      "box label without text",
      (f) => delete texts(f, "en")["sheet.primary.nerve"],
      'texts/en/ sheet.primary.nerve: missing text (label of box "nerve" in sheet section "primary")',
    ],
    [
      "mark sign without text",
      (f) => delete texts(f, "de")["sheet.knacks.mark.steady"],
      'texts/de/ sheet.knacks.mark.steady: missing text (sign of a mark in sheet section "knacks")',
    ],
    [
      "mark legend without text",
      (f) => delete texts(f, "en")["sheet.knacks.mark.path.legend"],
      'texts/en/ sheet.knacks.mark.path.legend: missing text (legend of a mark in sheet section "knacks")',
    ],
    [
      "mark on a tag no thing carries",
      (f) => (knacksSection(f).marks[2].tags = ["shaky"]),
      'sheet.json sections[8].marks[2].tags[0]: no thing carries tag "shaky"',
    ],
    [
      "mark from things that do not exist",
      (f) => (knacksSection(f).marks[0].from = { kind: "guild" }),
      'sheet.json sections[8].marks[0].from.kind: unknown kind "guild" (known: folk, upbringing, calling, path, talent, trait, knack, item, …)',
    ],
    [
      "mark that says nothing about the rows",
      (f) =>
        (knacksSection(f).marks[0] = {
          text: "sheet.knacks.mark.calling",
          legend: "sheet.knacks.mark.calling.legend",
        }),
      'sheet.json sections[8].marks[0]: a mark needs one of "tags", "how", "from", "pickedIn", "marked", "unmarked"',
    ],
    [
      "groups by rank without a word for rank",
      (f) => delete texts(f, "en")["rank.name"],
      'texts/en/ rank.name: missing text (word for rank, heading the groups of sheet section "knacks")',
    ],
    [
      "groups by rank, but nothing has a rank",
      (f) => (f.get("sheet.json").sections.find((s: { id: string }) => s.id === "traits").byRank = true),
      "sheet.json sections[7].byRank: none of the things selected here has a rank",
    ],
    [
      "lead on things that do not exist",
      (f) => (knacksSection(f).lead.things = { tags: ["guild"] }),
      'sheet.json sections[8].lead.things.tags[0]: no thing carries tag "guild"',
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
    [
      "text variant in one language only",
      (f) => delete texts(f, "en")["choice.talents-herbalist.variant.hillfolk.intro"],
      'texts/en/ choice.talents-herbalist.variant.hillfolk.intro: missing text (text of variant "hillfolk" of choice "talents-herbalist")',
    ],
    [
      "text variant condition with unknown value",
      (f) => (f.get("flow.json").choices[4].textVariants[0].when = "luckk > 2"),
      'flow.json choices[4].textVariants[0].when: expression "luckk > 2" uses unknown value "luckk"',
    ],
    [
      "text variant declared twice",
      (f) => f.get("flow.json").choices[4].textVariants.push({ id: "hillfolk", when: "level >= 2" }),
      'flow.json choices[4].textVariants: text variant "hillfolk" is declared twice',
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
      "lead text for a thing the lead does not select",
      (f) => (texts(f, "de")["knack.eddy.knacks.change"] = "Tauschen."),
      "texts/de/core.json entries.knack.eddy.knacks.change: text is not used by anything in the package",
    ],
    [
      "name too long",
      (f) => (texts(f, "de")["knack.eddy.name"] = "Ein sehr langer Name für einen Kniff"),
      "texts/de/core.json entries.knack.eddy.name: is 36 characters long as shown; the style limit is 30",
    ],
    [
      "choice never asked",
      (f) => f.get("flow.json").steps.splice(0, 1),
      'flow.json choices[15]: choice "name" is never asked: no step lists it and no thing grants it',
    ],
    [
      "list detail that no listed thing has",
      (f) => (f.get("sheet.json").sections.find((s: { id: string }) => s.id === "gear").detail = "inside"),
      'sheet.json sections[14].detail: no thing listed here has a text "<thing>.inside"',
    ],
    [
      "text variant without texts",
      (f) => (f.get("flow.json").choices[0].textVariants = [{ id: "quiet", when: "level >= 2" }]),
      'flow.json choices[0].textVariants: text variant "quiet" has no texts and changes nothing',
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(true);
    expect(messages(r, "warnings")).toContain(expected);
  });
});

describe("style limits of short texts", () => {
  /** Three sentences, exactly n characters. */
  const sized = (n: number) => {
    const head = "Your light guards everyone close to you. Once per rest you may shine. Everyone near you";
    return `${head}${" glows".repeat(40)}`.slice(0, n - 1) + ".";
  };
  const warnings = (change: (f: RawFiles) => void) => messages(mutate(change), "warnings");

  it("allows 3 sentences and 240 characters for a thing a feature table prints without a card", () => {
    expect(warnings((f) => (texts(f, "en")["path.lightwarden.short"] = sized(240)))).toEqual([]);
  });

  it("warns above 240 characters as shown", () => {
    expect(warnings((f) => (texts(f, "en")["path.lightwarden.short"] = sized(242)))).toContain(
      "texts/en/core.json entries.path.lightwarden.short: is 242 characters long as shown; the style limit is 240",
    );
  });

  it("warns above 3 sentences", () => {
    expect(
      warnings((f) => (texts(f, "en")["path.lightwarden.short"] = "Glow. Shine. Guard. Rest.")),
    ).toContain("texts/en/core.json entries.path.lightwarden.short: has 4 sentences; the style limit is 3");
  });

  it("counts a glossary link as its words", () => {
    const linked = sized(230).replace("guards", "[[glossary:guard|guards]]");
    expect(linked.length).toBeGreaterThan(240);
    expect(warnings((f) => (texts(f, "en")["path.lightwarden.short"] = linked))).toEqual([]);
  });

  it("keeps 120 characters for a thing with a card", () => {
    expect(warnings((f) => (texts(f, "en")["knack.eddy.short"] = sized(130)))).toContain(
      "texts/en/core.json entries.knack.eddy.short: is 130 characters long as shown; the style limit is 120",
    );
  });

  it("lets the package name be longer than a thing name", () => {
    expect(
      warnings((f) => (texts(f, "en")["package.name"] = "Mistland, a made-up world for testing")),
    ).toEqual([]);
  });

  it("counts plain units in official rules texts once per file", () => {
    const w = warnings((f) => {
      texts(f, "en")["knack.eddy.rules"] = "Water swirls up to 6 m away.";
      texts(f, "en")["knack.whirlpool.rules"] = "A whirlpool 9 m wide.";
    });
    expect(w).toEqual([
      "texts/en/core.json : 2 official rules text(s) state a unit as plain text; they stay verbatim, so readers see that unit unconverted",
    ]);
  });
});

describe("gather", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
  const choice = (f: RawFiles, id: string) => f.get("flow.json").choices.find((c: any) => c.id === id);
  const step = (f: RawFiles, id: string) => f.get("flow.json").steps.find((s: any) => s.id === id);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  // The demo gathers its knack choices in one step with `sections` near the end.
  const gatherKnacks = (f: RawFiles, together?: string) => {
    if (together) step(f, "knacks").together = together;
    else delete step(f, "knacks").together;
  };

  it("accepts a gather step and the choices gathered there", () => {
    const r = mutate((f) => gatherKnacks(f, "list"));
    expect(messages(r)).toEqual([]);
    expect(messages(r, "warnings")).toEqual([]);
  });

  it("needs step texts for a step that shows its choices together", () => {
    const r = mutate((f) => delete texts(f, "en")["step.knacks.intro"]);
    expect(messages(r)).toContain(
      'texts/en/ step.knacks.intro: missing text (introduction of step "knacks")',
    );
  });

  it("does not need step texts when each gathered choice is its own step", () => {
    const r = mutate((f) => {
      gatherKnacks(f);
      for (const lang of ["de", "en"])
        for (const field of ["title", "question", "intro"]) delete texts(f, lang)[`step.knacks.${field}`];
    });
    expect(messages(r)).toEqual([]);
  });

  it("uses a title of a step whose gathered choices stand one by one, and nothing more", () => {
    const r = mutate((f) => {
      gatherKnacks(f);
      for (const lang of ["de", "en"])
        for (const field of ["question", "intro"]) delete texts(f, lang)[`step.knacks.${field}`];
    });
    expect(messages(r)).toEqual([]);
    expect(messages(r, "warnings")).toEqual([]);
  });

  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "the same group gathered twice",
      (f) => {
        gatherKnacks(f);
        f.get("flow.json").steps.push({ id: "knacks-again", gather: "knacks" });
      },
      'flow.json steps[16].gather: group "knacks" is already gathered in step "knacks"',
    ],
    [
      "a list step with a choice that is not picked from a list",
      (f) => {
        gatherKnacks(f, "list");
        step(f, "looks").choices = ["age"];
        choice(f, "looks").gather = "knacks";
        thing(f, "callings-and-paths", "calling.herbalist").grants.push({ choice: "looks" });
      },
      'flow.json choices[18].gather: step "knacks" shows one list of options; choice "looks" is text',
    ],
  ])("rejects %s", (_name, change, expected) => {
    expect(messages(mutate(change))).toContain(expected);
  });

  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "a group without a gather step",
      (f) => (choice(f, "gear").gather = "kit"),
      'flow.json choices[7].gather: no step gathers group "kit"; the choice is asked right after the step that grants it',
    ],
    [
      "a gathered choice listed in a fixed step",
      (f) => {
        gatherKnacks(f);
        choice(f, "folk").gather = "knacks";
      },
      'flow.json choices[0].gather: choice "folk" is listed in step "folk", so it is never gathered',
    ],
    [
      "a gather step without choices",
      (f) => f.get("flow.json").steps.push({ id: "spare", gather: "spare" }),
      'flow.json steps[16].gather: no choice is gathered in group "spare"; the step is never shown',
    ],
  ])("warns about %s", (_name, change, expected) => {
    expect(messages(mutate(change), "warnings")).toContain(expected);
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

describe("levels 1 to 20 (format 0.9)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
  const choiceIndex = (id: string) =>
    (demo as RawFiles).get("flow.json").choices.findIndex((c: any) => c.id === id);
  const choice = (f: RawFiles, id: string) => f.get("flow.json").choices[choiceIndex(id)];
  const valueIndex = (id: string) => (demo as RawFiles).get("values.json").findIndex((v: any) => v.id === id);
  const thingIndex = (file: string, id: string) =>
    (demo as RawFiles).get(`things/${file}.json`).findIndex((t: any) => t.id === id);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("checks the shape of the new fields", () => {
    const r = mutate((f) => {
      f.get("values.json")[valueIndex("knackRank")].formula = "level";
      choice(f, "boon-raise").methods[0].points = 0;
      choice(f, "knacks-root").count = { byLevel: [2, 0] };
      thing(f, "boons-and-high-levels", "boon.raise").repeatable = "yes";
    });
    const p = (id: string) => `flow.json choices[${choiceIndex(id)}]`;
    expect(messages(r)).toEqual(
      expect.arrayContaining([
        `values.json [${valueIndex("knackRank")}]: use only one of formula, default, byLevel and byValue`,
        `${p("boon-raise")}.methods[0].points: Too small: expected number to be >0`,
        `${p("knacks-root")}.count.byLevel[1]: Too small: expected number to be >0`,
        "things/boons-and-high-levels.json [0].repeatable: Invalid input: expected boolean, received string",
      ]),
    );
  });

  it.each<[string, (f: RawFiles) => void, () => string]>([
    [
      "a value's table of the wrong length",
      (f) => (f.get("values.json")[valueIndex("knackRank")].byLevel = [1, 2, 3]),
      () => `values.json [${valueIndex("knackRank")}].byLevel: has 3 numbers, but levels 1 to 20 need 20`,
    ],
    [
      "a grant's table of the wrong length",
      (f) => (thing(f, "callings-and-paths", "calling.lantern-bearer").grants.at(-1).add = { byLevel: [1] }),
      () => {
        const grants = (demo as RawFiles).get("things/callings-and-paths.json")[0].grants.length;
        return `things/callings-and-paths.json [0].grants[${grants - 1}].add.byLevel: has 1 numbers, but levels 1 to 20 need 20`;
      },
    ],
    [
      "a count table of the wrong length",
      (f) => (choice(f, "knacks-root").count = { byLevel: [2, 3] }),
      () =>
        `flow.json choices[${choiceIndex("knacks-root")}].count.byLevel: has 2 numbers, but levels 1 to 20 need 20`,
    ],
    [
      "a count table asking for more than there are options",
      (f) => (choice(f, "knacks-root").count = { byLevel: Array.from({ length: 20 }, () => 12) }),
      () => `flow.json choices[${choiceIndex("knacks-root")}].count: asks for 12 but only 9 options exist`,
    ],
    [
      "raising next to another method",
      (f) => choice(f, "boon-raise").methods.push({ method: "array", values: [1, 1, 1, 1] }),
      () =>
        `flow.json choices[${choiceIndex("boon-raise")}].methods: "raise" adds to values and cannot be offered next to other methods`,
    ],
    [
      "a cap on an unknown value",
      (f) => (choice(f, "keen-senses-raise").methods[0].cap = "10 + practise"),
      () =>
        `flow.json choices[${choiceIndex("keen-senses-raise")}].methods[0].cap: expression "10 + practise" uses unknown value "practise"`,
    ],
    [
      "a raise recommendation with more points than there are",
      (f) => (choice(f, "boon-raise").recommend[0].assign = { heart: 2, wit: 1 }),
      () =>
        `flow.json choices[${choiceIndex("boon-raise")}].recommend[0].assign: gives more than the 2 points there are`,
    ],
    [
      "a raise recommendation over the most per target",
      (f) => (choice(f, "boon-raise").methods[0].maxPerTarget = 1),
      () =>
        `flow.json choices[${choiceIndex("boon-raise")}].recommend[0].assign: gives a target less than 0 or more than 1 points`,
    ],
    [
      "a table where a value takes input",
      (f) => (choice(f, "scores").targets[0] = "knackRank"),
      () =>
        `flow.json choices[${choiceIndex("scores")}].targets[0]: value "knackRank" has a formula and cannot take input`,
    ],
    [
      "a row badge on a value the choice does not set",
      (f) => choice(f, "scores").badges[0].targets.push("luck"),
      () =>
        `flow.json choices[${choiceIndex("scores")}].badges[0].targets[2]: "luck" is not a target of this choice`,
    ],
    [
      "a row badge whose condition uses an unknown value",
      (f) => (choice(f, "scores").badges[0].when = "hart > 2"),
      () =>
        `flow.json choices[${choiceIndex("scores")}].badges[0].when: expression "hart > 2" uses unknown value "hart"`,
    ],
  ])("rejects %s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected());
  });

  it("lets a raise add to any value, also one with a formula", () => {
    const r = mutate((f) => choice(f, "keen-senses-raise").targets.push("nerve"));
    expect(messages(r)).toEqual([]);
  });

  it.each<[string, (f: RawFiles) => void, () => string]>([
    [
      "a repeatable thing that asks nothing",
      (f) => (thing(f, "boons-and-high-levels", "boon.sure-step").repeatable = true),
      () =>
        `things/boons-and-high-levels.json [${thingIndex("boons-and-high-levels", "boon.sure-step")}].repeatable: the thing grants no choice; picking it again changes nothing (a thing counts once)`,
    ],
    [
      "more per target than there are points",
      (f) => (choice(f, "boon-raise").methods[0].maxPerTarget = 3),
      () =>
        `flow.json choices[${choiceIndex("boon-raise")}].methods[0].maxPerTarget: is more than the 2 points there are`,
    ],
  ])("warns about %s", (_name, change, expected) => {
    const r = mutate(change);
    expect(messages(r)).toEqual([]);
    expect(messages(r, "warnings")).toContain(expected());
  });
});

describe("uses by value and picks among what the character has (format 0.10)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
  const choiceIndex = (id: string) =>
    (demo as RawFiles).get("flow.json").choices.findIndex((c: any) => c.id === id);
  const choice = (f: RawFiles, id: string) => f.get("flow.json").choices[choiceIndex(id)];
  const thingIndex = (file: string, id: string) =>
    (demo as RawFiles).get(`things/${file}.json`).findIndex((t: any) => t.id === id);
  const sectionIndex = (id: string) =>
    (demo as RawFiles).get("sheet.json").sections.findIndex((s: any) => s.id === id);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("accepts a stat that names a value, as use boxes and on a card", () => {
    const r = mutate((f) => (thing(f, "knacks", "knack.spark-shower").stats.uses = { value: "practice" }));
    expect(messages(r)).toEqual([]);
  });

  it("lets an answers section print the picks of an owned choice", () => {
    expect(messages(mutate(() => {}))).toEqual([]);
    const r = mutate((f) => delete choice(f, "lantern-mastery").options.owned);
    expect(messages(r)).toContain(
      `sheet.json sections[${sectionIndex("mastery")}].choices[0]: choice "lantern-mastery" is pickMany; answers shows text and number choices and picks with options.owned`,
    );
  });

  it.each<[string, (f: RawFiles) => void, () => string]>([
    [
      "a stat that names an unknown value",
      (f) => (thing(f, "boons-and-high-levels", "trait.bloom-ward").stats.uses = { value: "bloomUses" }),
      () =>
        `things/boons-and-high-levels.json [${thingIndex("boons-and-high-levels", "trait.bloom-ward")}].stats.uses.value: unknown value "bloomUses"`,
    ],
    [
      "an owned choice in a shared list",
      (f) => (choice(f, "lantern-mastery").gather = "talents"),
      () =>
        `flow.json choices[${choiceIndex("lantern-mastery")}].gather: step "talents" shows one list without what the character has; choice "lantern-mastery" offers only that (options.owned)`,
    ],
    [
      "owned that is not true/false",
      (f) => (choice(f, "lantern-mastery").options.owned = "yes"),
      () =>
        `flow.json choices[${choiceIndex("lantern-mastery")}].options.owned: Invalid input: expected boolean, received string`,
    ],
  ])("rejects %s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected());
  });
});

describe("counts and what the sheet needs at the table (format 0.13)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
  const provisions = (f: RawFiles) =>
    thing(f, "callings-and-paths", "calling.lantern-bearer").grants.find(
      (g: any) => g.thing === "item.provisions",
    );
  const section = (f: RawFiles, id: string) => f.get("sheet.json").sections.find((s: any) => s.id === id);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("accepts a whole count of 1 or more on a thing grant", () => {
    expect(messages(mutate((f) => (provisions(f).count = 1)))).toEqual([]);
    expect(messages(mutate((f) => (provisions(f).count = 20)))).toEqual([]);
  });

  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "count 0",
      (f) => (provisions(f).count = 0),
      "things/callings-and-paths.json [0].grants[4].count: Too small: expected number to be >=1",
    ],
    [
      "count as a fraction",
      (f) => (provisions(f).count = 1.5),
      "things/callings-and-paths.json [0].grants[4].count: Invalid input: expected int, received number",
    ],
    [
      "count on a value grant",
      (f) => (thing(f, "callings-and-paths", "calling.lantern-bearer").grants[0].count = 2),
      'things/callings-and-paths.json [0].grants[0].count: "count" only goes with "thing"',
    ],
    [
      "header answer of an unknown choice",
      (f) => (section(f, "header").fields[0].choice = "homeland"),
      'sheet.json sections[0].fields[0].choice: unknown choice "homeland"',
    ],
    [
      "header label without text",
      (f) => (section(f, "header").fields[0].label = "sheet.header.folk"),
      'texts/de/ sheet.header.folk: missing text (label of header field "folk")',
    ],
    [
      "box text on a pencil box",
      (f) => (section(f, "primary").boxes[0].text = { text: "sheet.recovery.rest-dice" }),
      "sheet.json sections[1].boxes[0].text: a pencil box has no text, only a field",
    ],
    [
      "box text from an unknown value",
      (f) => (section(f, "recovery").boxes[0].text.vars.die = "restDieSize"),
      'sheet.json sections[2].boxes[0].text.vars.die: unknown value "restDieSize"',
    ],
    [
      "box text with a variable the box does not fill",
      (f) => (texts(f, "de")["sheet.recovery.rest-dice"] = "{{var:count}} × W{{var:sides}}"),
      'texts/de/core.json entries.sheet.recovery.rest-dice: uses {{var:sides}}, but no stat with this text supplies "sides"',
    ],
    [
      "unknown box style",
      (f) => (section(f, "recovery").boxes[1].style = "ticks"),
      'sheet.json sections[2].boxes[1].style: Invalid option: expected one of "number"|"pencil"|"circles"|"boxes"',
    ],
    [
      "further number of an unknown value",
      (f) => (section(f, "scores").scores[0].extra = "mightStand"),
      'sheet.json sections[3].scores[0].extra: unknown value "mightStand"',
    ],
    [
      "label of a derived number that is not there",
      (f) => delete section(f, "scores").scores[0].derived,
      'sheet.json sections[3].scores[0].derivedLabel: "derivedLabel" only goes with "derived"',
    ],
    [
      "label of a further number that is not there",
      (f) => delete section(f, "scores").scores[0].extra,
      'sheet.json sections[3].scores[0].extraLabel: "extraLabel" only goes with "extra"',
    ],
    [
      "strong marks that are about nothing in the list",
      (f) => (section(f, "talents").strong = { kind: "handling" }),
      "sheet.json sections[4].strong: none of these things is `about` a thing listed in this section",
    ],
    [
      "feature note from a stat nobody has",
      (f) => (section(f, "knacks").note = "colour"),
      'sheet.json sections[8].note: no thing has a stat "colour"',
    ],
    [
      "grouped by rank and by origin",
      (f) => (section(f, "knacks").groupBy = "origin"),
      'sheet.json sections[8].groupBy: rows are grouped one way: "byRank" or "groupBy", not both',
    ],
    [
      "unknown grouping",
      (f) => (section(f, "traits").groupBy = "kind"),
      'sheet.json sections[7].groupBy: Invalid input: expected "origin"',
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected);
  });
});

describe("header fields of things, the double mark explained only where it is (format 0.14)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
  const section = (f: RawFiles, id: string) => f.get("sheet.json").sections.find((s: any) => s.id === id);
  const buildField = (f: RawFiles) => section(f, "header").fields[2];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("accepts things selected by tags or ids when the field has a label", () => {
    expect(
      messages(
        mutate(
          (f) =>
            (section(f, "header").fields[2] = {
              things: { ids: ["build.slight"] },
              label: "kind.build.name",
            }),
        ),
      ),
    ).toEqual([]);
  });

  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "header field of a kind the package does not have",
      (f) => (buildField(f).things = { kind: "size" }),
      'sheet.json sections[0].fields[2].things.kind: unknown kind "size" (known: folk, upbringing, calling, path, talent, trait, knack, item, …)',
    ],
    [
      "header field of things without a kind and without a label",
      (f) => (buildField(f).things = { ids: ["build.slight", "build.sturdy"] }),
      'sheet.json sections[0].fields[2]: needs a "label": without "things.kind" there is no kind name to print',
    ],
    [
      "header field of things that selects nothing",
      (f) => (buildField(f).things = { kind: "build", tags: ["bonus-talent"] }),
      "sheet.json sections[0].fields[2].things: selects no things",
    ],
    [
      "header field of things with a label without text",
      (f) => (buildField(f).label = "sheet.header.build"),
      'texts/de/ sheet.header.build: missing text (label of header field "build")',
    ],
    [
      "legend of the double mark without text",
      (f) => (section(f, "talents").strongLegend = "sheet.talents.twice"),
      'texts/de/ sheet.talents.twice: missing text (legend of the double mark in sheet section "talents")',
    ],
    [
      "legend of the double mark on a list without one",
      (f) => delete section(f, "talents").strong,
      'sheet.json sections[4].strongLegend: explains the double mark, but the section has no "strong"',
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected);
  });
});

describe("marks by what an owned choice marked, owned only from some choices (format 0.14)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into raw JSON */
  const choiceIndex = (id: string) =>
    (demo as RawFiles).get("flow.json").choices.findIndex((c: any) => c.id === id);
  const choice = (f: RawFiles, id: string) => f.get("flow.json").choices[choiceIndex(id)];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const book = 1; // the herb book mark: picked in knacks-root, not marked in rooted-focus

  it.each<[string, (f: RawFiles) => void, () => string]>([
    [
      "marked by a choice that does not exist",
      (f) => (knacksSection(f).marks[book].unmarked = ["rooted-fokus"]),
      () => 'sheet.json sections[8].marks[1].unmarked[0]: unknown choice "rooted-fokus"',
    ],
    [
      "marked by a choice that marks nothing",
      (f) => (knacksSection(f).marks[book].marked = ["knacks-root"]),
      () =>
        'sheet.json sections[8].marks[1].marked[0]: choice "knacks-root" marks nothing; name a choice with options.owned',
    ],
    [
      "picked in a choice that only marks",
      (f) => (knacksSection(f).marks[0].not.pickedIn = ["lantern-mastery"]),
      () =>
        'sheet.json sections[8].marks[0].not.pickedIn[0]: choice "lantern-mastery" only marks what the character has (options.owned); it gives nothing',
    ],
    [
      "picked in a choice that picks nothing",
      (f) => (knacksSection(f).marks[book].pickedIn = ["scores"]),
      () =>
        'sheet.json sections[8].marks[1].pickedIn[0]: choice "scores" is distribute; name a pickOne or pickMany choice',
    ],
    [
      "a not that says nothing",
      (f) => (knacksSection(f).marks[0].not = {}),
      () =>
        'sheet.json sections[8].marks[0].not: a mark needs one of "tags", "how", "from", "pickedIn", "marked", "unmarked"',
    ],
    [
      "ownedFrom without owned",
      (f) => delete choice(f, "rooted-focus").options.owned,
      () =>
        `flow.json choices[${choiceIndex("rooted-focus")}].options.ownedFrom: "ownedFrom" narrows "owned": set "owned": true`,
    ],
    [
      "ownedFrom an unknown choice",
      (f) => (choice(f, "rooted-focus").options.ownedFrom = ["knacks-roots"]),
      () =>
        `flow.json choices[${choiceIndex("rooted-focus")}].options.ownedFrom[0]: unknown choice "knacks-roots"`,
    ],
    [
      "ownedFrom a choice that only marks",
      (f) => (choice(f, "rooted-focus").options.ownedFrom = ["lantern-mastery"]),
      () =>
        `flow.json choices[${choiceIndex("rooted-focus")}].options.ownedFrom[0]: choice "lantern-mastery" only marks what the character has (options.owned); it gives nothing`,
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected());
  });
});

describe("text variants of a filled text (format 0.15)", () => {
  const harm = (f: RawFiles) => thing(f, "items", "item.lantern-staff").stats.harm;
  const at = "things/items.json [0].stats.harm";

  it("accepts the demo package's variant", () => {
    expect(mutate(() => {}).ok).toBe(true);
  });

  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "a condition on an unknown value",
      (f) => (harm(f).variants[0].when = "levle >= 5"),
      `${at}.variants[0].when: expression "levle >= 5" uses unknown value "levle"`,
    ],
    [
      "a condition on a thing that does not exist",
      (f) => (harm(f).variants[0].when = "has('path.lightwardn')"),
      `${at}.variants[0].when: expression "has('path.lightwardn')" asks has("path.lightwardn") but there is no such thing`,
    ],
    [
      "a variant text missing in one language",
      (f) => delete f.get("texts/en/core.json").entries["stat-value.item.lantern-staff.harm.bright"],
      "texts/en/ stat-value.item.lantern-staff.harm.bright: missing text (stat text)",
    ],
    [
      "a variant text with a variable the stat does not supply",
      (f) =>
        (f.get("texts/de/core.json").entries["stat-value.item.lantern-staff.harm.bright"] =
          "1W6 {{var:glow|signed}}"),
      'texts/de/core.json entries.stat-value.item.lantern-staff.harm.bright: uses {{var:glow}}, but no stat with this text supplies "glow"',
    ],
    [
      "a variant without vars that uses a variable",
      (f) => delete harm(f).vars,
      'texts/de/core.json entries.stat-value.item.lantern-staff.harm.bright: uses {{var:bonus}}, but no stat with this text supplies "bonus"',
    ],
    [
      "a variant that names the same text",
      (f) => (harm(f).variants[0].text = "stat-value.item.lantern-staff.harm"),
      `${at}.variants: text "stat-value.item.lantern-staff.harm" is named twice`,
    ],
    [
      "an empty list of variants",
      (f) => (harm(f).variants = []),
      `${at}.variants: Too small: expected array to have >=1 items`,
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected);
  });
});

describe("card lines by origin (format 0.16)", () => {
  const origins = (f: RawFiles) => f.get("sheet.json").cards.knack.origins;
  const at = "sheet.json cards.knack.origins";

  it("accepts the demo package's lines", () => {
    expect(mutate(() => {}).ok).toBe(true);
  });

  it("accepts a package without them", () => {
    expect(mutate((f) => delete f.get("sheet.json").cards.knack.origins).ok).toBe(true);
  });

  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "a line that fills in an unknown value",
      (f) => (origins(f)[1].text.vars.hit = "knackHt"),
      `${at}[1].text.vars.hit: unknown value "knackHt"`,
    ],
    [
      "a line text missing in one language",
      (f) => delete f.get("texts/en/core.json").entries["card.knack.numbers"],
      "texts/en/ card.knack.numbers: missing text (stat text)",
    ],
    [
      "a label missing in one language",
      (f) => delete f.get("texts/de/core.json").entries["card.knack.borrowed"],
      'texts/de/ card.knack.borrowed: missing text (label of an origin line on "knack" cards)',
    ],
    [
      "a condition on an unknown choice",
      (f) => (origins(f)[0].pickedIn = ["borowed-knack"]),
      `${at}[0].pickedIn[0]: unknown choice "borowed-knack"`,
    ],
    [
      "a condition that selects no things",
      (f) => (origins(f)[1].from = { kind: "calling", tags: ["nothing-has-this"] }),
      `${at}[1].from: selects no things`,
    ],
    [
      "two entries with the same condition, the second never printed",
      (f) => origins(f).push({ ...structuredClone(origins(f)[1]), label: "card.knack.borrowed" }),
      `${at}: two entries have the same condition; the second is never printed`,
    ],
    [
      "an entry without a condition",
      (f) => (origins(f)[0] = { text: origins(f)[0].text }),
      `${at}[0]: a mark needs one of "tags", "how", "from", "pickedIn", "marked", "unmarked"`,
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected);
  });
});

describe("things every character has (format 0.17)", () => {
  it("accepts a package without them", () => {
    expect(mutate((f) => delete f.get("flow.json").grants).ok).toBe(true);
  });

  it.each<[string, (f: RawFiles) => void, string]>([
    [
      "an unknown thing",
      (f) => f.get("flow.json").grants.push("talent.mist-sign"),
      'flow.json grants[1]: unknown thing "talent.mist-sign"',
    ],
    [
      "a thing twice",
      (f) => f.get("flow.json").grants.push("talent.mist-signs"),
      'flow.json grants: thing "talent.mist-signs" is granted twice',
    ],
  ])("%s", (_name, change, expected) => {
    const r = mutate(change);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(expected);
  });

  it("is a list with at least one thing", () => {
    expect(mutate((f) => (f.get("flow.json").grants = [])).ok).toBe(false);
  });
});

describe("sections apart (format 0.18)", () => {
  const knacks = (f: RawFiles) => f.get("sheet.json").sections.find((s: { id: string }) => s.id === "knacks");

  it("accepts the demo package's apart sections, and a package without them", () => {
    expect(mutate(() => {}).ok).toBe(true);
    expect(
      mutate((f) => {
        for (const s of f.get("sheet.json").sections) delete s.apart;
      }).ok,
    ).toBe(true);
  });

  it("rejects an apart that is not true or false", () => {
    const r = mutate((f) => (knacks(f).apart = "page"));
    expect(r.ok).toBe(false);
    expect(messages(r).some((m) => m.startsWith("sheet.json sections[") && m.includes(".apart"))).toBe(true);
  });
});
