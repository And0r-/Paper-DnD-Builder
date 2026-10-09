/**
 * Tracks in the guided flow (concept AND-262, 6.2 to 6.5), on the demo
 * package's example characters: the step "Your levels", steps of an added
 * track named after it, the growth by track, a raise that keeps its tracks.
 */
import { evaluateDraft, type DraftDocument } from "@builder/core";
import { DEMO_EXAMPLES_DIR, DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir } from "@builder/format";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translator } from "../../i18n/index.ts";
import { summaryLineText } from "../characters.tsx";
import { levelGrowth } from "../flow/explain.ts";
import { answerThings, buildFlow, firstOpen, TRACKS_KEY } from "../flow/model.ts";
import { evaluateBefore, flowOf } from "../flow/raise.ts";
import { measureContext } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { summarize } from "@builder/core";
import { notMetText } from "./screens.tsx";

const pkg = (await validatePackageDir(DEMO_PACKAGE_DIR)).package!;
const texts: LoadedPackage["texts"] = {};
for (const f of await readdir(join(DEMO_PACKAGE_DIR, "texts", "de"))) {
  const file = JSON.parse(await readFile(join(DEMO_PACKAGE_DIR, "texts", "de", f), "utf8")) as {
    entries: LoadedPackage["texts"];
  };
  Object.assign(texts, file.entries);
}
const lp: LoadedPackage = { pkg, lang: "de", texts };
const { t } = translator("de");

async function example(name: string): Promise<DraftDocument> {
  return JSON.parse(await readFile(join(DEMO_EXAMPLES_DIR, `${name}.json`), "utf8")) as DraftDocument;
}

describe("tracks in the flow", () => {
  it("puts the step for the levels right after the tracks choice, from level 2 on", async () => {
    const doc = await example("lantern-herbalist");
    const flow = buildFlow("d", lp, evaluateDraft(pkg, doc), t);
    const keys = flow.map((e) => e.key);
    const at = keys.indexOf(TRACKS_KEY);
    expect(at).toBeGreaterThan(0);
    // Right after the step of the tracks choice.
    expect(keys[at - 1]).toBe("calling");
    const entry = flow[at]!;
    expect(entry).toMatchObject({
      kind: "tracks",
      status: "done",
      parts: 1,
      title: "Woher jede Stufe kommt",
    });
    // Its own counted step.
    expect(flow[at - 1]!.section).toBeLessThan(entry.section);
    expect(flow[at + 1]!.section).toBeGreaterThan(entry.section);

    const one = buildFlow("d", lp, evaluateDraft(pkg, { ...doc, level: 1, tracks: [] }), t);
    expect(one.map((e) => e.key)).not.toContain(TRACKS_KEY);
  });

  it("names the track and its level on a step of an added track", async () => {
    const doc = await example("lantern-herbalist");
    const flow = buildFlow("d", lp, evaluateDraft(pkg, doc), t);
    const added = flow.find((e) => e.key === "herb-craft@calling.herbalist")!;
    expect(added).toMatchObject({ track: "calling.herbalist", trackLevel: 1, atLevel: 4 });
    // A step of the first track keeps the character level.
    expect(flow.find((e) => e.key === "path")!.track).toBeUndefined();
  });

  it("leads to the step for the levels when a track no longer fits", async () => {
    const doc = await example("lantern-herbalist");
    // Wit below what adding the herbalist needs: the levels stay, the step says so.
    const scores = doc.answers["scores"] as { method: number; assign: Record<string, number> };
    const low = {
      ...doc,
      answers: { ...doc.answers, scores: { ...scores, assign: { ...scores.assign, witBase: 4 } } },
    };
    const ev = evaluateDraft(pkg, low);
    expect(ev.tracks?.unfit).toEqual(["calling.herbalist"]);
    const flow = buildFlow("d", lp, ev, t);
    expect(flow.find((e) => e.key === TRACKS_KEY)!.status).toBe("needsAttention");
    expect(firstOpen(flow).key).toBe(TRACKS_KEY);
  });

  it("splits what grows with the level by track", async () => {
    const ev = evaluateDraft(pkg, await example("lantern-herbalist"));
    const growth = levelGrowth(lp, ev);
    const herbalist = growth.byThing.filter((g) => g.track === "calling.herbalist");
    expect(herbalist.flatMap((g) => g.values)).toEqual(["rootKnackRank"]);
    expect(growth.byThing.filter((g) => g.track === "calling.herbalist").map((g) => g.thing)).toEqual([
      "calling.herbalist",
    ]);
  });

  it("shows numbers two tracks share once, for the whole character, and numbers of one track's levels under it", async () => {
    // Invented: each calling raises its own glow places by a table; the package counts
    // `glowPlaces` for the character from them, and `lanternDice` follows the lantern levels alone.
    const p = structuredClone(pkg);
    p.values.push(
      { id: "ownGlow", source: "mistland", default: 0 },
      { id: "glowPlaces", source: "mistland", formula: "if(count('calling') > 1, glowLevel, ownGlow)" },
      { id: "lanternDice", source: "mistland", formula: "levelOf('calling.lantern-bearer')" },
    );
    for (const c of ["calling.lantern-bearer", "calling.herbalist"])
      p.things.find((x) => x.id === c)!.grants!.push({ value: "ownGlow", add: { byLevel: [1, 2, 3, 4, 5] } });
    const named: LoadedPackage = {
      pkg: p,
      lang: "de",
      texts: {
        ...texts,
        "value.ownGlow.name": "Eigene Glutplätze",
        "value.glowPlaces.name": "Glutplätze",
        "value.lanternDice.name": "Laternenwürfel",
      },
    };
    const ev = evaluateDraft(p, await example("lantern-herbalist"));
    const growth = levelGrowth(named, ev);
    // Not the sum of both tables (3 + 2), but what the package counts.
    expect(ev.values["ownGlow"]).toBe(5);
    expect(growth.shared).toContain("glowPlaces");
    expect(growth.shared).not.toContain("ownGlow");
    expect(growth.byThing.flatMap((g) => g.values)).not.toContain("ownGlow");
    // Levels of more than one calling (glow level) count for the whole character too.
    expect(growth.shared).toContain("glowLevel");
    expect(growth.byThing.find((g) => g.thing === "calling.lantern-bearer")!.values).toContain("lanternDice");
    expect(growth.byThing.find((g) => g.thing === "calling.herbalist")!.values).not.toContain("lanternDice");
    // One calling's own glow places are not the character's: the overview names them nowhere,
    // also not in the line of what that calling gives (AND-311).
    expect(growth.summed).toEqual(["ownGlow"]);
    const gifts = ev.choices["calling-gifts"]!;
    expect(gifts.info!.values.map((v) => v.value)).toContain("ownGlow");
    const skip = new Set([...growth.own, ...growth.shared, ...growth.summed]);
    expect(
      answerThings(named, measureContext(named, undefined), gifts, skip, ev.values)!.values.join(),
    ).not.toContain("Eigene Glutplätze");

    // One calling: a table by level stays the calling's.
    const single = levelGrowth(
      named,
      evaluateDraft(p, { ...(await example("lantern-herbalist")), tracks: [] }),
    );
    expect(single.shared).toEqual([]);
    expect(single.summed).toEqual([]);
    expect(single.byThing.find((g) => g.thing === "calling.lantern-bearer")!.values).toEqual(
      expect.arrayContaining(["ownGlow", "lanternDice"]),
    );
  });

  it("names the condition that fails, also of a track the character had", async () => {
    const doc = await example("lantern-herbalist");
    // First the herbalist, then the lantern bearer: heart 12 is fine, wit 6 fails the herbalist.
    const low: DraftDocument = {
      ...doc,
      answers: {
        ...doc.answers,
        calling: { pick: "calling.herbalist" },
        scores: { method: 0, assign: { mightBase: 8, graceBase: 8, witBase: 6, heartBase: 12 } },
      },
      tracks: ["calling.herbalist", "calling.herbalist", "calling.lantern-bearer", "calling.lantern-bearer"],
    };
    const ev = evaluateDraft(pkg, low);
    expect(ev.tracks!.unfit).toEqual(["calling.lantern-bearer"]);
    const text = notMetText(
      lp,
      t,
      "calling.lantern-bearer",
      ev.tracks!.unfitNotMet["calling.lantern-bearer"],
    );
    expect(text).toBe(`Für Kräuterkundige, deine bisherige Wahl: ${texts["calling.herbalist.addReason"]}`);
    expect(text).not.toContain(texts["calling.lantern-bearer.addReason"]!);
    expect(notMetText(lp, t, "calling.herbalist", ["calling.herbalist"])).toBe(
      texts["calling.herbalist.addReason"],
    );
  });

  it("writes the head line with both tracks, most levels first", async () => {
    const doc = await example("lantern-herbalist");
    const ev = evaluateDraft(pkg, doc);
    expect(summaryLineText(lp, summarize(pkg, doc, ev).line)).toBe(
      "Laternenträgerin 3 / Kräuterkundige 2 · Stufe 5",
    );
    const single = { ...doc, tracks: [] };
    expect(summaryLineText(lp, summarize(pkg, single, evaluateDraft(pkg, single)).line)).toBe(
      "Laternenträgerin · Stufe 5",
    );
  });

  it("keeps the tracks of the old levels for the character before a raise", async () => {
    const doc = await example("lantern-herbalist");
    const raised: DraftDocument = {
      ...doc,
      level: 6,
      levelBefore: 5,
      tracks: [...doc.tracks!, "calling.herbalist"],
    };
    const before = evaluateBefore(pkg, raised, 5);
    expect(before.tracks?.list.map((x) => [x.thing, x.levels])).toEqual([
      ["calling.lantern-bearer", 3],
      ["calling.herbalist", 2],
    ]);
    const { raise, entries } = flowOf("d", lp, raised, evaluateDraft(pkg, raised), t);
    expect(raise).toEqual({ from: 5, to: 6 });
    // The step for the levels is not one of the raise's questions.
    expect(entries.map((e) => e.key)).not.toContain(TRACKS_KEY);
  });
});
