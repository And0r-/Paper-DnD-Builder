import {
  applyChange,
  evaluateDraft,
  levelUp,
  newDraft,
  type ChoiceState,
  type DraftChange,
  type DraftDocument,
} from "@builder/core";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir } from "@builder/format";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translator } from "../../i18n/index.ts";
import type { LoadedPackage } from "../packages.ts";
import { levelGrowth } from "./explain.ts";
import { evaluateBefore, flowOf, raiseNews } from "./raise.ts";

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

function apply(doc: DraftDocument, c: DraftChange): DraftDocument {
  const r = applyChange(pkg, doc, c);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.doc;
}

function recommendation(c: ChoiceState): unknown {
  const rec = c.recommended;
  if (c.kind === "pickOne") return { pick: (rec as string[])[0] };
  if (c.kind === "pickMany") return { picks: (rec as string[]).slice(0, c.count) };
  if (c.kind === "distribute") return rec;
  if (c.kind === "number") return { value: 20 };
  return { text: "Mira" };
}

/** Answers what is open, one step after another as the flow shows them; returns the steps it went through. */
function answerFlow(doc: DraftDocument): { doc: DraftDocument; visited: string[] } {
  const visited: string[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const ev = evaluateDraft(pkg, doc);
    const { entries } = flowOf("x", lp, doc, ev, t);
    for (const e of entries) if (e.kind === "step" && !visited.includes(e.key)) visited.push(e.key);
    if (ev.complete) return { doc, visited };
    const step = ev.steps.find((s) => s.status !== "done")!;
    // Never asked outside the flow on screen.
    expect(entries.map((e) => e.key)).toContain(step.id);
    if (step.pool) {
      doc = apply(doc, { type: "pool", step: step.id, picks: step.pool.recommended });
      continue;
    }
    const open = step.choices.map((c) => ev.choices[c]!).find((c) => c.status !== "answered")!;
    doc = apply(doc, { type: "answer", choice: open.id, answer: recommendation(open) });
  }
  throw new Error("did not complete");
}

function built(level: number, calling = "calling.lantern-bearer"): DraftDocument {
  const created = newDraft(pkg, level);
  if (!created.ok) throw new Error("newDraft");
  const doc = apply(created.doc, {
    type: "answer",
    choice: "calling",
    answer: { pick: calling },
  });
  return answerFlow(doc).doc;
}

function raised(doc: DraftDocument, level: number) {
  const r = levelUp(pkg, doc, level);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  const ev = evaluateDraft(pkg, r.doc);
  const flow = flowOf("x", lp, r.doc, ev, t);
  const { doc: answered, visited } = answerFlow(r.doc);
  // Finishing ends the raise.
  const { levelBefore: _, ...finished } = answered;
  return { flow, visited, doc: finished };
}

describe("the flow of a level up", () => {
  it("asks only what levels 2, 3 and 5 bring, counted from 1", () => {
    const l1 = built(1);
    const to2 = raised(l1, 2);
    expect(to2.flow.raise).toEqual({ from: 1, to: 2 });
    expect(to2.flow.entries.map((e) => e.key)).toEqual(["talents", "knacks", "overview"]);
    expect(to2.flow.entries.map((e) => e.section)).toEqual([0, 1, 2]);
    // Steps that were there before and only ask more say the new level.
    expect(to2.flow.entries.map((e) => e.atLevel)).toEqual([2, 2, 1]);
    expect(to2.visited).toEqual(["talents", "knacks"]);
    // The overview still has every step.
    expect(to2.flow.all.length).toBeGreaterThan(10);

    const to3 = raised(to2.doc, 3);
    expect(to3.flow.entries.filter((e) => e.kind === "step").map((e) => e.key)).toEqual(["path"]);
    expect(to3.visited).toEqual(["path"]);

    const to5 = raised(to3.doc, 5);
    const keys = to5.flow.entries.map((e) => e.key);
    expect(keys).toEqual(["boon-4", "knacks", "overview"]);
    // The raise that boon 4 brings joins the flow once the boon is chosen, as a part of its step.
    expect(to5.visited).toEqual(["boon-4", "knacks", "boon-raise@boon-4"]);
  });

  it("asks every new step of levels 2 to 20 in one go, and nothing chosen before", () => {
    const l1 = built(1);
    const before = new Set(evaluateDraft(pkg, l1).steps.map((s) => s.id));
    const to20 = raised(l1, 20);
    const asked = to20.visited.filter((k) => before.has(k));
    // Of the steps level 1 had, only those that ask more at the new levels.
    expect(asked.sort()).toEqual(["knacks", "talents"]);
    for (const id of ["path", "lantern-vow", "boon-4", "boon-8", "boon-12", "boon-16", "boon-19"]) {
      expect(to20.visited).toContain(id);
    }
    expect(to20.flow.entries[0]!.section).toBe(0);
  });

  it("is the whole flow when no raise is under way", () => {
    const l3 = built(3);
    const flow = flowOf("x", lp, l3, evaluateDraft(pkg, l3), t);
    expect(flow.raise).toBeNull();
    expect(flow.entries.map((e) => e.key)).toEqual(flow.all.map((e) => e.key));
  });

  it("names what a level up brought: new things and changed numbers", () => {
    const l1 = built(1);
    const to3 = raised(raised(l1, 2).doc, 3);
    const ev = evaluateDraft(pkg, to3.doc);
    const news = raiseNews(evaluateBefore(pkg, to3.doc, 2), ev, ["stamina", "guard", "practice"]);
    expect(news.things).toContain("path.lightwarden");
    expect(news.values).toEqual([
      { id: "stamina", before: 13, after: 18 },
      { id: "guard", before: 8, after: 9 },
    ]);
  });

  it("grows only the uses of abilities the character has", () => {
    // Ward uses grow by the herbalist's level; only the herbalist's ward names them.
    const lantern = levelGrowth(lp, evaluateDraft(pkg, built(11)));
    expect(lantern.own).toContain("practice");
    const grown = (g: ReturnType<typeof levelGrowth>) => [...g.own, ...g.byThing.flatMap((b) => b.values)];
    expect(grown(lantern)).not.toContain("bloomWardUses");
    const herbalist = evaluateDraft(pkg, built(11, "calling.herbalist"));
    expect(herbalist.things.map((h) => h.id)).toContain("trait.bloom-ward");
    const growth = levelGrowth(lp, herbalist);
    // The herbalist's calling grants them by its own level (format 0.21), so they grow with it.
    expect(growth.byThing.find((b) => b.thing === "calling.herbalist")?.values).toContain("bloomWardUses");
    expect(grown(growth).filter((v) => v === "bloomWardUses")).toEqual(["bloomWardUses"]);
    expect(new Set(grown(growth)).size).toBe(grown(growth).length);
  });
});
