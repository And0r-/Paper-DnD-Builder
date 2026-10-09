/**
 * The demo package's example characters with more than one calling
 * (`examples/`): every number and fact in `expected.json` as the core works
 * it out. Invented rules only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_EXAMPLES_DIR, DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import {
  evaluateDraft,
  headTracks,
  levelUp,
  tracksText,
  type DraftDocument,
  type Evaluation,
} from "./index.ts";

interface Expected {
  levels: Record<string, number>;
  tracksLine?: Record<string, string>;
  complete: boolean;
  values?: Record<string, number>;
  counts?: Record<string, number>;
  has?: string[];
  hasNot?: string[];
  stepLevels?: Record<string, number>;
  notAsked?: string[];
  pickCounts?: Record<string, number>;
  options?: Record<string, { has?: string[]; hasNot?: string[]; maxRank?: number }>;
  refused?: { level: number; track: string; failed: string[]; reason: string };
  valuesBefore?: Record<string, number>;
}

let pkg: ContentPackage;
let expected: Record<string, Expected>;
const drafts: Record<string, DraftDocument> = {};
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  pkg = r.package;
  expected = JSON.parse(await readFile(join(DEMO_EXAMPLES_DIR, "expected.json"), "utf8"));
  for (const name of Object.keys(expected))
    drafts[name] = JSON.parse(await readFile(join(DEMO_EXAMPLES_DIR, `${name}.json`), "utf8"));
});

const rank = (id: string) => pkg.things.find((t) => t.id === id)?.rank ?? 0;

/** The checks every example shares, on an evaluation. */
function check(ev: Evaluation, x: Expected) {
  expect(Object.fromEntries(ev.tracks!.list.map((t) => [t.thing, t.levels]))).toEqual(x.levels);
  for (const [id, n] of Object.entries(x.values ?? {})) expect([id, ev.values[id]]).toEqual([id, n]);
  const held = ev.things.map((t) => t.id);
  for (const [id, n] of Object.entries(x.counts ?? {}))
    expect([id, ev.things.find((t) => t.id === id)?.count ?? 0]).toEqual([id, n]);
  for (const id of x.has ?? []) expect(held).toContain(id);
  for (const id of x.hasNot ?? []) expect(held).not.toContain(id);
  for (const [choice, level] of Object.entries(x.stepLevels ?? {}))
    expect([choice, ev.choices[choice]?.atLevel]).toEqual([choice, level]);
  for (const choice of x.notAsked ?? []) expect(Object.keys(ev.choices)).not.toContain(choice);
  for (const [choice, n] of Object.entries(x.pickCounts ?? {}))
    expect([choice, ev.choices[choice]?.count]).toEqual([choice, n]);
  for (const [choice, o] of Object.entries(x.options ?? {})) {
    const options = ev.choices[choice]!.options!;
    for (const id of o.has ?? []) expect(options).toContain(id);
    for (const id of o.hasNot ?? []) expect(options).not.toContain(id);
    if (o.maxRank !== undefined) expect(Math.max(...options.map(rank))).toBe(o.maxRank);
  }
}

describe("example characters with more than one calling", () => {
  for (const name of ["lantern-herbalist", "herbalist-river-runner"])
    it(`works out every expected number of ${name}`, () => {
      const x = expected[name]!;
      const ev = evaluateDraft(pkg, drafts[name]!);
      expect(ev.open).toEqual([]);
      expect(ev.tracks!.unfit).toEqual([]);
      expect(ev.complete).toBe(x.complete);
      check(ev, x);
      for (const [lang, line] of Object.entries(x.tracksLine ?? {}))
        expect(tracksText(headTracks(ev), (thing) => String(pkg.texts[lang]?.[`${thing}.name`]))).toBe(line);
    });

  it("refuses a calling whose condition, or the current calling's, does not hold", () => {
    const x = expected["refused-lantern-bearer"]!;
    const doc = drafts["refused-lantern-bearer"]!;
    const ev = evaluateDraft(pkg, doc);
    expect(ev.complete).toBe(false);
    expect(ev.tracks!.unfit).toEqual([x.refused!.track]);

    // The character as it was before that level.
    const before: DraftDocument = { ...doc, level: x.refused!.level - 1, tracks: doc.tracks!.slice(0, -1) };
    const evBefore = evaluateDraft(pkg, before);
    expect(evBefore.complete).toBe(true);
    check(evBefore, x);
    for (const [id, n] of Object.entries(x.valuesBefore!)) expect([id, evBefore.values[id]]).toEqual([id, n]);
    expect(evBefore.tracks!.options.find((o) => o.thing === x.refused!.track)).toEqual({
      thing: x.refused!.track,
      allowed: false,
      notMet: x.refused!.failed,
    });
    expect(x.refused!.reason).toBe(`${x.refused!.failed[0]}.addReason`);
    expect(pkg.texts.de?.[x.refused!.reason]).toBeTruthy();
    expect(levelUp(pkg, before, x.refused!.level, [x.refused!.track])).toMatchObject({
      ok: false,
      error: { code: "trackNotAllowed", thing: x.refused!.track, notMet: x.refused!.failed },
    });

    // As a river runner 3 nothing is refused; only the path of level 3 is still to choose.
    const same = evaluateDraft(pkg, { ...doc, tracks: [doc.tracks![0]!, doc.tracks![0]!] });
    expect(same.tracks!.unfit).toEqual([]);
    expect(same.open).toEqual(["path"]);
  });
});
