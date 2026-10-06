/**
 * The step count on every screen of a whole build (AND-77): "Step x of y"
 * and "Part x of y" never change without a note (not up, not down), and the bar moves on every
 * screen. The walk goes through the screens as a player does: the step,
 * "choose for me" (or a given pick), Next.
 *
 * WALK_PACKAGE_DIR runs the same walk against another package and prints
 * every screen (WALK_LEVEL, WALK_PICK="choice=thing,choice=thing").
 */
import { applyChange, evaluateDraft, newDraft, type DraftDocument } from "@builder/core";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir } from "@builder/format";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translator } from "../../i18n/index.ts";
import type { LoadedPackage } from "../packages.ts";
import { chooseForMe } from "./choose.ts";
import { positionOf, progressFraction } from "./model.ts";
import { flowOf } from "./raise.ts";

async function load(dir: string): Promise<LoadedPackage> {
  const r = await validatePackageDir(dir);
  if (!r.package) throw new Error(`package ${dir} does not load`);
  const texts: LoadedPackage["texts"] = {};
  for (const f of await readdir(join(dir, "texts", "de"))) {
    const file = JSON.parse(await readFile(join(dir, "texts", "de", f), "utf8")) as {
      entries: LoadedPackage["texts"];
    };
    Object.assign(texts, file.entries);
  }
  return { pkg: r.package, lang: "de", texts };
}

const { t } = translator("de");

function start(lp: LoadedPackage, level: number): DraftDocument {
  const created = newDraft(lp.pkg, level);
  if (!created.ok) throw new Error("newDraft");
  return created.doc;
}

interface Screen {
  key: string;
  current: number;
  total: number;
  part: number;
  parts: number;
  percent: number;
  /** Total or parts changed on the way to this screen (up or down); a step that showed no part count may show one on its second part. */
  changed: boolean;
}

/** Every screen from the first step to the overview, answering each step on the way. */
function walk(lp: LoadedPackage, start: DraftDocument, picks: Record<string, string> = {}): Screen[] {
  let doc = start;
  const screens: Screen[] = [];
  const flow = () => {
    const ev = evaluateDraft(lp.pkg, doc);
    return { ev, ...flowOf("x", lp, doc, ev, t) };
  };
  let { entries } = flow();
  let entry = entries[1]!;
  let before: Screen | undefined;
  for (let guard = 0; guard < 300 && entry.kind !== "overview"; guard++) {
    const p = positionOf(entries, entry);
    const screen = {
      key: entry.key,
      current: p.current,
      total: p.total,
      part: p.part,
      parts: p.parts,
      percent: Math.round(progressFraction(entries, entry) * 100),
      changed:
        before !== undefined &&
        (p.total !== before.total ||
          (p.current === before.current && before.parts > 1 && p.parts !== before.parts)),
    };
    screens.push(screen);
    before = screen;
    // The player answers: a given pick, else "choose for me".
    const now = flow();
    const step = now.ev.steps.find((s) => s.id === entry.key);
    if (step && step.status !== "done") {
      const own = step.choices.filter((c) => picks[c] !== undefined);
      const changes =
        own.length > 0
          ? own.map((c) => ({ type: "answer" as const, choice: c, answer: { pick: picks[c] } }))
          : (chooseForMe(lp, doc, now.ev, step.id, () => 0) ?? []);
      for (const c of changes) {
        const r = applyChange(lp.pkg, doc, c);
        if (r.ok) doc = r.doc;
      }
      if (own.length > 0) {
        const again = chooseForMe(lp, doc, evaluateDraft(lp.pkg, doc), step.id, () => 0) ?? [];
        for (const c of again) {
          const r = applyChange(lp.pkg, doc, c);
          if (r.ok) doc = r.doc;
        }
      }
    }
    ({ entries } = flow());
    const i = entries.findIndex((e) => e.key === entry.key);
    entry = entries[i + 1]!;
  }
  return screens;
}

function line(s: Screen): string {
  const part = s.parts > 1 ? ` · Teil ${s.part} von ${s.parts}` : "";
  return `Schritt ${s.current} von ${s.total}${part} · ${s.percent}% · ${s.key}${s.changed ? "  ← CHANGED" : ""}`;
}

const external = process.env["WALK_PACKAGE_DIR"];

describe.skipIf(external !== undefined)("step count on the demo package", async () => {
  const lp = await load(DEMO_PACKAGE_DIR);
  // The plan gives an open step the parts of its suggestion: before the
  // player picks, "Part 1 of 2" would count a part another pick does not
  // bring (AND-189). The first part counts none until the parts are there.
  it("shows no part count on an open step whose parts only the plan has", () => {
    let doc = start(lp, 5);
    const pick = applyChange(lp.pkg, doc, {
      type: "answer",
      choice: "calling",
      answer: { pick: "calling.lantern-bearer" },
    });
    if (!pick.ok) throw new Error("calling");
    doc = pick.doc;
    const at = (key: string) => {
      const { entries } = flowOf("x", lp, doc, evaluateDraft(lp.pkg, doc), t);
      const entry = entries.find((e) => e.key === key)!;
      return { planned: entry.count?.parts, ...positionOf(entries, entry) };
    };
    expect(at("boon-4")).toMatchObject({ planned: 2, part: 1, parts: 1 });
    for (const c of chooseForMe(lp, doc, evaluateDraft(lp.pkg, doc), "boon-4", () => 0) ?? []) {
      const r = applyChange(lp.pkg, doc, c);
      if (r.ok) doc = r.doc;
    }
    expect(at("boon-4")).toMatchObject({ part: 1, parts: 2 });
    expect(at("boon-raise@boon-4")).toMatchObject({ part: 2, parts: 2 });
  });

  for (const level of [1, 5, 20]) {
    it(`never changes on the recommended way, level ${level}`, () => {
      const screens = walk(lp, start(lp, level));
      expect(screens.filter((s) => s.changed).map(line)).toEqual([]);
      // The bar moves on every screen.
      for (const [i, s] of screens.entries())
        if (i > 0) expect(s.percent).toBeGreaterThan(screens[i - 1]!.percent);
    });
  }

  // Several choices share one long recommendation (like a list of tricks at
  // levels 16 and 19). Once level 16 takes the first, the rule core suggests
  // the next one for level 19, a boon without a raise. The plan must see the
  // same, or "Part x of 10" drops to "of 9" halfway through (AND-90).
  it("holds when a later choice's suggestion moves on to the next recommended thing", () => {
    const calm = {
      id: "boon.still-water",
      kind: "boon",
      source: "mistland",
    } as (typeof lp.pkg.things)[number];
    const recommend = [{ pick: ["boon.sure-step", "boon.still-water"] }];
    const shared: LoadedPackage = {
      ...lp,
      pkg: {
        ...lp.pkg,
        things: [...lp.pkg.things, calm],
        flow: {
          ...lp.pkg.flow,
          choices: lp.pkg.flow.choices.map((c) =>
            c.id === "boon-16" || c.id === "boon-19"
              ? ({ ...c, kind: "pickMany", count: 1, recommend } as typeof c)
              : c,
          ),
        },
      },
    };
    const screens = walk(shared, start(shared, 20));
    expect(screens.filter((s) => s.changed).map(line)).toEqual([]);
    // Boons 4, 8 and 12 with their raises, then sure step and still water.
    expect(screens.filter((s) => s.key.startsWith("boon-")).map((s) => s.parts)).toEqual([
      8, 8, 8, 8, 8, 8, 8, 8,
    ]);
  });
});

describe.skipIf(external === undefined)("step count on another package", () => {
  it("walks and prints every screen", async () => {
    const lp = await load(external!);
    const picks = Object.fromEntries(
      (process.env["WALK_PICK"] ?? "")
        .split(",")
        .filter(Boolean)
        .map((p) => p.split("=") as [string, string]),
    );
    const screens = walk(lp, start(lp, Number(process.env["WALK_LEVEL"] ?? 5)), picks);
    process.stdout.write(`${screens.map(line).join("\n")}\n`);
  });
});
