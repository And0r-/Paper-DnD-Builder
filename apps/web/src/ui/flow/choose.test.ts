import {
  applyChange,
  evaluateDraft,
  levelUp,
  newDraft,
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
import { measureContext } from "../package-text.ts";
import { chooseForMe } from "./choose.ts";
import { missingText } from "./model.ts";
import { flowOf } from "./raise.ts";

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

/** Answers every open step with "choose for me", in flow order. */
function chooseAll(doc: DraftDocument, skip: ReadonlySet<string> = new Set()): DraftDocument {
  for (let guard = 0; guard < 200; guard++) {
    const ev = evaluateDraft(pkg, doc);
    const step = ev.steps.find((s) => s.status !== "done" && !skip.has(s.id));
    if (!step) return doc;
    const changes = chooseForMe(lp, doc, ev, step.id, () => 0);
    if (!changes) throw new Error(`nothing to choose on ${step.id}`);
    for (const c of changes) doc = apply(doc, c);
  }
  throw new Error("did not complete");
}

/** A level-2 herbalist whose root knacks and borrowed knack are picked by hand. */
function herbalist(): DraftDocument {
  const created = newDraft(pkg, 2);
  if (!created.ok) throw new Error("newDraft");
  let doc = apply(created.doc, { type: "answer", choice: "calling", answer: { pick: "calling.herbalist" } });
  doc = apply(doc, {
    type: "answer",
    choice: "knacks-root",
    answer: { picks: ["knack.mushroom-glow", "knack.thorn-ring", "knack.herb-scent"] },
  });
  // The borrowed knack is one the root knacks also offer.
  doc = apply(doc, { type: "answer", choice: "borrowed-knack", answer: { picks: ["knack.quiet-word"] } });
  doc = chooseAll(doc);
  expect(evaluateDraft(pkg, doc).complete).toBe(true);
  const r = levelUp(pkg, doc, 20);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.doc;
}

describe("choose for me", () => {
  it("keeps the picks of a step that grew, and fills only the new places", () => {
    const doc = herbalist();
    const ev = evaluateDraft(pkg, doc);
    expect(ev.choices["knacks-root"]!.count).toBe(8);
    const changes = chooseForMe(lp, doc, ev, "knacks", () => 0)!;
    const after = evaluateDraft(pkg, changes.reduce(apply, doc));
    const picks = (after.choices["knacks-root"]!.answer as { picks: string[] }).picks;
    expect(picks.slice(0, 3)).toEqual(["knack.mushroom-glow", "knack.thorn-ring", "knack.herb-scent"]);
    expect(picks).toHaveLength(8);
    expect(new Set(picks).size).toBe(8);
    expect(after.choices["knacks-root"]!.status).toBe("answered");
  });

  it("leaves out what the character has from another choice, so no earlier step opens again", () => {
    const doc = herbalist();
    const ev = evaluateDraft(pkg, doc);
    const changes = chooseForMe(lp, doc, ev, "knacks", () => 0)!;
    const after = evaluateDraft(pkg, changes.reduce(apply, doc));
    const picks = (after.choices["knacks-root"]!.answer as { picks: string[] }).picks;
    expect(picks).not.toContain("knack.quiet-word");
    expect(after.choices["borrowed-knack"]!.answer).toEqual({ picks: ["knack.quiet-word"] });
    expect(after.choices["borrowed-knack"]!.status).toBe("answered");
    // Nothing the character had before the level up is open now.
    const before = evaluateDraft(pkg, { level: 2, answers: doc.answers });
    const old = new Set(before.steps.map((s) => s.id));
    expect(after.steps.filter((s) => old.has(s.id) && s.status !== "done").map((s) => s.id)).toEqual([]);
  });

  it("answers a whole level up to 20 without asking anything twice", () => {
    let doc = herbalist();
    const ev = evaluateDraft(pkg, doc);
    const asked = flowOf("x", lp, doc, ev, t)
      .entries.filter((e) => e.kind === "step")
      .map((e) => e.key);
    doc = chooseAll(doc);
    const done = evaluateDraft(pkg, doc);
    expect(done.complete).toBe(true);
    // Every pick counts: nothing was taken twice.
    expect(Object.values(done.choices).filter((c) => c.status === "invalid")).toEqual([]);
    // The steps asked did not change on the way.
    expect(asked).toContain("knacks");
    expect(asked).not.toContain("upbringing");
  });

  it("picks among what the character has where a choice asks for that", () => {
    const created = newDraft(pkg, 20);
    if (!created.ok) throw new Error("newDraft");
    let doc = apply(created.doc, {
      type: "answer",
      choice: "calling",
      answer: { pick: "calling.lantern-bearer" },
    });
    doc = chooseAll(doc, new Set(["lantern-mastery"]));
    const ev = evaluateDraft(pkg, doc);
    const changes = chooseForMe(lp, doc, ev, "lantern-mastery", () => 0)!;
    expect(changes).toEqual([
      {
        type: "answer",
        choice: "lantern-mastery",
        answer: { picks: ["knack.warm-glow", "knack.glow-thread"] },
      },
    ]);
  });

  it("keeps the old picks of a shared list that grew", () => {
    const created = newDraft(pkg, 1);
    if (!created.ok) throw new Error("newDraft");
    let doc = apply(created.doc, {
      type: "answer",
      choice: "calling",
      answer: { pick: "calling.lantern-bearer" },
    });
    doc = chooseAll(doc);
    const was = evaluateDraft(pkg, doc).steps.find((s) => s.id === "talents")!.pool!.picks;
    const r = levelUp(pkg, doc, 20);
    if (!r.ok) throw new Error("levelUp");
    const ev = evaluateDraft(pkg, r.doc);
    const step = ev.steps.find((s) => s.id === "talents")!;
    expect(step.pool!.count).toBeGreaterThan(was.length);
    const changes = chooseForMe(lp, r.doc, ev, "talents", () => 0)!;
    const pool = evaluateDraft(pkg, changes.reduce(apply, r.doc)).steps.find(
      (s) => s.id === "talents",
    )!.pool!;
    for (const p of was) expect(pool.picks).toContain(p);
    expect(pool.remaining).toBe(0);
  });
});

describe("choose for me and texts at an option", () => {
  const FAR = "trait.far-lore";
  const start = () => {
    const d = newDraft(pkg, 1);
    if (!d.ok) throw new Error("no draft");
    return apply(d.doc, { type: "answer", choice: "calling", answer: { pick: "calling.herbalist" } });
  };

  it("cannot write a pick's texts: with the pick there and only texts open, it offers nothing", () => {
    const doc = apply(start(), { type: "answer", choice: "herb-craft", answer: { pick: FAR } });
    const ev = evaluateDraft(pkg, doc);
    expect(ev.choices["herb-craft"]!.textsMissing).toEqual([FAR]);
    expect(chooseForMe(lp, doc, ev, "herb-craft", () => 0)).toBeUndefined();
    expect(missingText(lp, measureContext(lp, undefined), ev.choices["herb-craft"]!, t)).toBe(
      "Schreib noch in die leeren Felder bei Fernkunde.",
    );
  });

  it("keeps the texts written for another pick when it picks the package's recommendation", () => {
    const texts = { [FAR]: { first: "Salzmarschen" } };
    const doc = start();
    // The stored answer is a pick that no longer fits; its texts stay with the new one.
    const stale = { ...doc, answers: { ...doc.answers, "herb-craft": { pick: "trait.nowhere", texts } } };
    const changes = chooseForMe(lp, stale, evaluateDraft(pkg, stale), "herb-craft", () => 0);
    expect(changes).toEqual([
      { type: "answer", choice: "herb-craft", answer: { pick: "trait.leaf-lore", texts } },
    ]);
  });
});
