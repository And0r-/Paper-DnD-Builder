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
import { buildFlow, firstOpen, TRACKS_KEY } from "../flow/model.ts";
import { evaluateBefore, flowOf } from "../flow/raise.ts";
import type { LoadedPackage } from "../packages.ts";
import { summarize } from "@builder/core";

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
