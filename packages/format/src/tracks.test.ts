/**
 * Format 0.21: levels in more than one track (flow.level.tracks, levelOf(),
 * addRequires, grants `only`, values by another value, rankUpTo, cardValues,
 * `{ "tracks": true }`). Every case starts from the demo package, which
 * uses tracks itself; `mutatePlain` starts from it without them.
 */
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { readPackageDir, type PackageFiles } from "./read.ts";
import { validatePackageFiles, type ValidationResult } from "./validate.ts";

const DEMO = fileURLToPath(new URL("../../demo-package", import.meta.url));

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
/**
 * The demo without anything that needs tracks, as a package before 0.21
 * would be: no flow.level.tracks, no addRequires (nor its texts), no
 * `only`, and `level` where the demo asks `levelOf()`.
 */
function withoutTracks(f: RawFiles): void {
  for (const [name, content] of f) {
    const plain = JSON.parse(JSON.stringify(content).replace(/levelOf\('[^']*'\)/g, "level"));
    if (name.startsWith("things/")) {
      for (const t of plain) {
        delete t.addRequires;
        for (const g of t.grants ?? []) delete g.only;
      }
    }
    if (name.startsWith("texts/")) {
      for (const key of Object.keys(plain.entries)) if (key.endsWith(".addReason")) delete plain.entries[key];
    }
    f.set(name, plain);
  }
  delete flow(f).level.tracks;
}
/** Like `mutate`, starting from the demo without tracks. */
function mutatePlain(change: (files: RawFiles) => void): ValidationResult {
  return mutate((f) => {
    withoutTracks(f);
    change(f);
  });
}
const flow = (f: RawFiles) => f.get("flow.json");
const choice = (f: RawFiles, id: string) => flow(f).choices.find((c: any) => c.id === id);
const value = (f: RawFiles, id: string) => f.get("values.json").find((v: any) => v.id === id);
const calling = (f: RawFiles, id: string) =>
  f.get("things/callings-and-paths.json").find((t: any) => t.id === id);
const text = (f: RawFiles, key: string, de: string, en: string) => {
  f.get("texts/de/core.json").entries[key] = de;
  f.get("texts/en/core.json").entries[key] = en;
};
const withTracks = (f: RawFiles, extra: object = {}) => {
  flow(f).level.tracks = { choice: "calling", ...extra };
};
/** A value worked out from the levels in two tracks, with its texts. */
const addValue = (f: RawFiles, v: { id: string } & Record<string, unknown>) => {
  f.get("values.json").push({ source: "mistland", ...v });
  text(f, `value.${v.id}.name`, "Wert", "Value");
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const messages = (r: ValidationResult, level: "errors" | "warnings" = "errors") =>
  r[level].map((i) => `${i.file} ${i.path}: ${i.message}`);

describe("tracks (format 0.21)", () => {
  it("accepts every new field together, without errors or warnings", () => {
    // The demo itself has tracks with addRequiresCurrent, addRequires, only, levelOf(),
    // tables by value, rankUpTo and cardValues; this adds the rest.
    const r = mutate((f) => {
      // A path comes through a calling's choice, so it belongs to that track too.
      f.get("things/callings-and-paths.json")
        .find((t: { id: string }) => t.id === "path.lightwarden")
        .grants.push({ value: "stamina", add: 1, only: "added" });
      choice(f, "borrowed-knack").cardValues = { knackHit: "borrowedKnackHit" };
      flow(f).summary.line.calling = { tracks: true };
      f.get("sheet.json").sections[0].fields.push({ tracks: true });
    });
    expect(messages(r)).toEqual([]);
    expect(messages(r, "warnings")).toEqual([]);
    expect(r.package?.flow.level.tracks).toEqual({ choice: "calling", addRequiresCurrent: true });
  });

  it("leaves a package without tracks as it was", () => {
    const r = mutatePlain(() => {});
    expect(r.ok).toBe(true);
    expect(r.package?.flow.level.tracks).toBeUndefined();
  });

  it.each([
    ["an unknown choice", "nope", 'flow.json level.tracks.choice: unknown choice "nope"'],
    [
      "a pickMany choice",
      "talents-herbalist",
      'flow.json level.tracks.choice: choice "talents-herbalist" is pickMany; tracks come from a pickOne choice',
    ],
    [
      "a choice that only marks",
      "deep-practice",
      'flow.json level.tracks.choice: choice "deep-practice" only marks what the character has (options.owned)',
    ],
    [
      "a granted choice",
      "path",
      'flow.json level.tracks.choice: choice "path" must be listed in a step: the first track is its answer',
    ],
  ])("rejects tracks from %s", (_, cid, message) => {
    const r = mutate((f) => (flow(f).level.tracks = { choice: cid }));
    expect(messages(r).some((m) => m.startsWith(message))).toBe(true);
  });

  it("rejects unknown fields in flow.level.tracks", () => {
    const r = mutate((f) => withTracks(f, { addRequiresAll: true }));
    expect(messages(r)).toEqual(['flow.json level.tracks: Unrecognized key: "addRequiresAll"']);
  });

  it("warns when addRequiresCurrent has nothing to check", () => {
    const r = mutatePlain((f) => withTracks(f, { addRequiresCurrent: true }));
    expect(messages(r, "warnings")).toEqual([
      'flow.json level.tracks.addRequiresCurrent: no thing has "addRequires"; there is nothing to check',
    ]);
  });
});

describe("levelOf() (format 0.21)", () => {
  it("rejects levelOf() without tracks", () => {
    const r = mutatePlain((f) => addValue(f, { id: "sparkLevel", formula: "levelOf('calling.herbalist')" }));
    expect(messages(r)).toContainEqual(
      expect.stringMatching(
        /^values\.json \[\d+\]\.formula: .*levelOf\("calling\.herbalist"\), but flow\.level\.tracks is not set$/,
      ),
    );
  });

  it("rejects levelOf() of a thing that is not a track", () => {
    const r = mutate((f) => {
      withTracks(f);
      calling(f, "calling.herbalist").requires = "levelOf('path.lightwarden') == 0";
    });
    expect(messages(r)).toEqual([
      `things/callings-and-paths.json [2].requires: expression "levelOf('path.lightwarden') == 0" asks levelOf("path.lightwarden"), but that is no option of the tracks choice "calling"`,
    ]);
  });

  it("rejects levelOf() without a quoted key", () => {
    const r = mutate((f) => {
      withTracks(f);
      addValue(f, { id: "glowLevel", formula: "levelOf(level)" });
    });
    expect(messages(r)[0]).toMatch(/levelOf\(\) takes a quoted string/);
  });
});

describe("addRequires (format 0.21)", () => {
  it("needs the reason text in every language", () => {
    const r = mutate((f) => {
      delete f.get("texts/de/tracks.json").entries["calling.herbalist.addReason"];
      delete f.get("texts/en/tracks.json").entries["calling.herbalist.addReason"];
    });
    expect(messages(r)).toEqual([
      'texts/de/ calling.herbalist.addReason: missing text (why "calling.herbalist" cannot be added)',
      'texts/en/ calling.herbalist.addReason: missing text (why "calling.herbalist" cannot be added)',
    ]);
  });

  it("rejects it on a thing that is not a track, and without tracks", () => {
    const onPath = mutate((f) => {
      withTracks(f);
      f.get("things/callings-and-paths.json")[3].addRequires = "wit >= 13";
      text(f, "path.lightwarden.addReason", "x", "x");
    });
    expect(messages(onPath)).toEqual([
      'things/callings-and-paths.json [3].addRequires: only a track can be added; "path.lightwarden" is no option of the tracks choice "calling"',
    ]);
    const noTracks = mutatePlain((f) => {
      calling(f, "calling.herbalist").addRequires = "wit >= 13";
      text(f, "calling.herbalist.addReason", "x", "x");
    });
    expect(messages(noTracks)).toEqual([
      "things/callings-and-paths.json [2].addRequires: only a track can be added, and flow.level.tracks is not set",
    ]);
  });

  it("checks the expression like requires", () => {
    const r = mutate((f) => {
      calling(f, "calling.herbalist").addRequires = "cunning >= 13";
    });
    expect(messages(r)).toEqual([
      'things/callings-and-paths.json [2].addRequires: expression "cunning >= 13" uses unknown value "cunning"',
    ]);
  });
});

describe("grants only for the first or an added track (format 0.21)", () => {
  it("rejects other words than first and added", () => {
    const r = mutate((f) => {
      withTracks(f);
      calling(f, "calling.herbalist").grants[0].only = "second";
    });
    expect(messages(r)[0]).toMatch(/^things\/callings-and-paths\.json \[2\]\.grants\[0\]\.only: /);
  });

  it("rejects only without tracks", () => {
    const r = mutatePlain((f) => (calling(f, "calling.herbalist").grants[0].only = "first"));
    expect(messages(r)).toEqual([
      'things/callings-and-paths.json [2].grants[0].only: "only" needs tracks, and flow.level.tracks is not set',
    ]);
  });

  it("warns about only on a thing that never comes through a track", () => {
    const r = mutate((f) => {
      withTracks(f);
      f.get("things/folks-and-upbringings.json")[0].grants.push({ value: "stamina", add: 1, only: "added" });
    });
    expect(r.ok).toBe(true);
    expect(messages(r, "warnings")).toEqual([
      expect.stringMatching(/never belongs to a track .* so this grant never applies$/),
    ]);
  });
});

describe("a value as a table by another value (format 0.21)", () => {
  const table = [0, 2, 3, 4];

  it("rejects an unknown value, the value itself and a circle", () => {
    const unknown = mutate((f) => addValue(f, { id: "sharedSlots", byValue: "sparkLevel", table }));
    expect(messages(unknown)).toContainEqual(expect.stringMatching(/byValue: unknown value "sparkLevel"$/));
    const self = mutate((f) => addValue(f, { id: "sharedSlots", byValue: "sharedSlots", table }));
    expect(messages(self)).toContainEqual(
      expect.stringMatching(/byValue: a value cannot be a table by itself$/),
    );
    const circle = mutate((f) => {
      addValue(f, { id: "sparkLevel", formula: "sharedSlots + 1" });
      addValue(f, { id: "sharedSlots", byValue: "sparkLevel", table });
    });
    expect(messages(circle)).toContain(
      "values.json : formulas depend on each other in a circle: sparkLevel → sharedSlots → sparkLevel",
    );
  });

  it("needs byValue and table together, and no other base", () => {
    const alone = mutate((f) => addValue(f, { id: "sharedSlots", byValue: "level" }));
    expect(messages(alone)).toContainEqual(
      expect.stringMatching(/table: "byValue" and "table" go together$/),
    );
    const both = mutate((f) => addValue(f, { id: "sharedSlots", byValue: "level", table, default: 1 }));
    expect(messages(both)).toContainEqual(
      expect.stringMatching(/use only one of formula, default, byLevel and byValue$/),
    );
  });

  it("warns when the table is shorter than the other value can get", () => {
    const r = mutate((f) => addValue(f, { id: "sharedSlots", byValue: "might", table }));
    expect(r.ok).toBe(true);
    expect(messages(r, "warnings")).toEqual([
      expect.stringMatching(
        /table: has 4 numbers, but "might" goes up to 15; higher values get the last number$/,
      ),
    ]);
  });

  it("takes no input from a choice", () => {
    const r = mutate((f) => {
      value(f, "mightBase").byValue = "level";
      value(f, "mightBase").table = [6];
      delete value(f, "mightBase").default;
    });
    expect(messages(r)).toContainEqual(
      expect.stringMatching(/targets\[0\]: value "mightBase" has a formula and cannot take input$/),
    );
  });
});

describe("rankUpTo and cardValues (format 0.21)", () => {
  it("checks rankUpTo as an expression", () => {
    const r = mutate((f) => (choice(f, "knacks-lantern").options.rankUpTo = "lanternRank"));
    expect(messages(r)).toContainEqual(
      expect.stringMatching(/options\.rankUpTo: expression "lanternRank" uses unknown value "lanternRank"$/),
    );
  });

  it("warns about rankUpTo when no option has a rank", () => {
    const r = mutate((f) => (choice(f, "folk").options.rankUpTo = "knackRank"));
    expect(messages(r, "warnings")).toContainEqual(
      expect.stringMatching(
        /options\.rankUpTo: none of this choice's options has a rank; all count as rank 0$/,
      ),
    );
  });

  it("rejects cardValues that name unknown values", () => {
    const r = mutate(
      (f) => (choice(f, "borrowed-knack").cardValues = { knackHit: "glowHit", knackDc: "knackHit" }),
    );
    expect(messages(r)).toContainEqual(
      expect.stringMatching(/cardValues\.knackHit: unknown value "glowHit"$/),
    );
    expect(messages(r)).toContainEqual(
      expect.stringMatching(/cardValues\.knackDc: unknown value "knackDc"$/),
    );
  });

  it("warns about cardValues on a choice whose options have no card", () => {
    const r = mutate((f) => (choice(f, "folk").cardValues = { knackHit: "borrowedKnackHit" }));
    expect(messages(r, "warnings")).toContainEqual(
      expect.stringMatching(/cardValues: none of this choice's options has a card$/),
    );
  });

  it("takes cardValues only on pick choices", () => {
    const r = mutate((f) => (choice(f, "scores").cardValues = { knackHit: "borrowedKnackHit" }));
    expect(messages(r)).toContainEqual(expect.stringMatching(/Unrecognized key: "cardValues"$/));
  });
});

describe("the tracks in the summary line and the header (format 0.21)", () => {
  it("needs flow.level.tracks", () => {
    const r = mutatePlain((f) => {
      flow(f).summary.line.calling = { tracks: true };
      f.get("sheet.json").sections[0].fields.push({ tracks: true, label: "choice.calling.title" });
    });
    expect(messages(r)).toEqual([
      "flow.json summary.line.calling: names the tracks, but flow.level.tracks is not set",
      "sheet.json sections[0].fields[3].tracks: flow.level.tracks is not set",
    ]);
  });

  it("takes only true", () => {
    const r = mutate((f) => {
      withTracks(f);
      flow(f).summary.line.calling = { tracks: false };
    });
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toMatch(/^flow\.json summary\.line\.calling/);
  });
});

describe("the demo's example drafts with more than one calling", () => {
  const dir = fileURLToPath(new URL("../../demo-package/examples", import.meta.url));
  const drafts = ["lantern-herbalist", "herbalist-river-runner", "refused-lantern-bearer"];

  it.each(drafts)("%s names only choices, tracks and things of the package", async (name) => {
    const { readFile } = await import("node:fs/promises");
    const doc = JSON.parse(await readFile(`${dir}/${name}.json`, "utf8"));
    const pkg = validatePackageFiles(demo).package!;
    const choices = new Set(pkg.flow.choices.map((c) => c.id));
    const things = new Set(pkg.things.map((t) => t.id));
    const tracks = new Set(pkg.things.filter((t) => t.kind === "calling").map((t) => t.id));
    expect(doc.tracks.length).toBe(doc.level - 1);
    for (const t of doc.tracks) expect(tracks).toContain(t);
    for (const [key, answer] of Object.entries<{ pick?: string; picks?: string[] }>(doc.answers)) {
      const [declared, track] = key.split("@");
      expect(choices, key).toContain(declared);
      if (track) expect(tracks, key).toContain(track);
      for (const id of [answer.pick, ...(answer.picks ?? [])].filter(Boolean))
        expect(things, key).toContain(id);
    }
  });
});
