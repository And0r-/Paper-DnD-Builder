/**
 * The step count on every screen of a whole build (AND-77): "Step x of y"
 * and "Part x of y" never grow without a note, and the bar moves on every
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
  /** Total or parts went up on the way to this screen, and whether a note said so. */
  grew: boolean;
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
      grew: before !== undefined && (p.total > before.total || (p.current === before.current && p.parts > before.parts)),
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
  return `Schritt ${s.current} von ${s.total}${part} · ${s.percent}% · ${s.key}${s.grew ? "  ← GREW" : ""}`;
}

const external = process.env["WALK_PACKAGE_DIR"];

describe.skipIf(external !== undefined)("step count on the demo package", async () => {
  const lp = await load(DEMO_PACKAGE_DIR);
  for (const level of [1, 5, 20]) {
    it(`never grows on the recommended way, level ${level}`, () => {
      const screens = walk(lp, start(lp, level));
      expect(screens.filter((s) => s.grew).map(line)).toEqual([]);
      // The bar moves on every screen.
      for (const [i, s] of screens.entries()) if (i > 0) expect(s.percent).toBeGreaterThan(screens[i - 1]!.percent);
    });
  }
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
