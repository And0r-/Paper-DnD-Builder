/**
 * Texts at an option (`textInputs`): the demo's herbalist may pick "far
 * lore" in `herb-craft` and then names two lands. Invented content only.
 */
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import { applyChange, evaluateDraft, newDraft, type DraftChange, type DraftDocument } from "./index.ts";

const FAR = "trait.far-lore";
const LEAF = "trait.leaf-lore";

let pkg: ContentPackage;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  pkg = r.package;
});

function apply(doc: DraftDocument, change: DraftChange, p = pkg): DraftDocument {
  const r = applyChange(p, doc, change);
  if (!r.ok) throw new Error(`${JSON.stringify(change)}: ${JSON.stringify(r.error)}`);
  return r.doc;
}
const answer = (choice: string, a: unknown): DraftChange => ({ type: "answer", choice, answer: a });

function herbalist(): DraftDocument {
  const start = newDraft(pkg, 1);
  if (!start.ok) throw new Error(JSON.stringify(start.error));
  return apply(start.doc, answer("calling", { pick: "calling.herbalist" }));
}

describe("texts at an option", () => {
  it("asks for the needed texts of a pick: without them the choice is not done", () => {
    const doc = apply(herbalist(), answer("herb-craft", { pick: FAR }));
    const ev = evaluateDraft(pkg, doc);
    expect(ev.choices["herb-craft"]).toMatchObject({
      status: "incomplete",
      textsMissing: [FAR],
      remaining: 0,
    });
    expect(ev.open).toContain("herb-craft");
    expect(ev.steps.find((s) => s.choices.includes("herb-craft"))!.status).toBe("open");
    // The pick counts already: the character has the thing, without texts.
    expect(ev.things.find((t) => t.id === FAR)).toMatchObject({ pickedIn: "herb-craft" });
    expect(ev.things.find((t) => t.id === FAR)!.texts).toBeUndefined();

    const one = apply(doc, answer("herb-craft", { pick: FAR, texts: { [FAR]: { first: "Salt Marshes" } } }));
    expect(evaluateDraft(pkg, one).choices["herb-craft"]).toMatchObject({
      status: "incomplete",
      textsMissing: [FAR],
    });
  });

  it("gives the picked thing its texts, trimmed, in the thing's order", () => {
    const doc = apply(
      herbalist(),
      answer("herb-craft", {
        pick: FAR,
        texts: { [FAR]: { second: " Ember Hills ", first: "Salt Marshes" } },
      }),
    );
    const ev = evaluateDraft(pkg, doc);
    expect(ev.choices["herb-craft"]!.status).toBe("answered");
    expect(ev.choices["herb-craft"]!.textsMissing).toBeUndefined();
    expect(ev.things.find((t) => t.id === FAR)!.texts).toEqual(["Salt Marshes", "Ember Hills"]);
  });

  it.each([
    ["a text over maxLength", "x".repeat(41), "tooLong"],
    ["a line break", "Salt\nMarshes", "badCharacters"],
    ["a control character", "Salt\u0007", "badCharacters"],
  ])("refuses %s", (_name, text, problem) => {
    const r = applyChange(
      pkg,
      herbalist(),
      answer("herb-craft", { pick: FAR, texts: { [FAR]: { first: text, second: "Ember Hills" } } }),
    );
    expect(r).toEqual({ ok: false, error: { code: "answerDoesNotFit", problem } });
  });

  it("refuses texts that are no strings, and keeps texts of another pick for going back", () => {
    expect(
      applyChange(pkg, herbalist(), answer("herb-craft", { pick: FAR, texts: { [FAR]: { first: 3 } } })),
    ).toEqual({ ok: false, error: { code: "answerDoesNotFit", problem: "badShape" } });
    const texts = { [FAR]: { first: "Salt Marshes", second: "Ember Hills" } };
    const doc = apply(herbalist(), answer("herb-craft", { pick: LEAF, texts }));
    const ev = evaluateDraft(pkg, doc);
    // A thing without inputs needs no text; the far lore's texts wait in the answer.
    expect(ev.choices["herb-craft"]!.status).toBe("answered");
    expect(ev.things.find((t) => t.id === LEAF)!.texts).toBeUndefined();
    const back = apply(doc, answer("herb-craft", { pick: FAR, texts }));
    expect(evaluateDraft(pkg, back).things.find((t) => t.id === FAR)!.texts).toEqual([
      "Salt Marshes",
      "Ember Hills",
    ]);
  });

  it("needs no optional text", () => {
    const p = structuredClone(pkg);
    p.things.find((t) => t.id === FAR)!.textInputs![1]!.optional = true;
    const doc = apply(
      herbalist(),
      answer("herb-craft", { pick: FAR, texts: { [FAR]: { first: "Salt Marshes" } } }),
      p,
    );
    const ev = evaluateDraft(p, doc);
    expect(ev.choices["herb-craft"]!.status).toBe("answered");
    expect(ev.things.find((t) => t.id === FAR)!.texts).toEqual(["Salt Marshes"]);
  });

  it("keeps the texts of a pick on a list step when the picks move between its choices", () => {
    // Legends asks for a text in this variant; the talents step is one shared list.
    const p = structuredClone(pkg);
    p.things.find((t) => t.id === "talent.legends")!.textInputs = [{ id: "tale", maxLength: 40 }];
    let doc: DraftDocument = { level: 1, answers: {} };
    for (const [c, a] of [
      ["calling", { pick: "calling.lantern-bearer" }],
      ["upbringing", { pick: "upbringing.ferry-child" }],
      ["folk", { pick: "folk.hillfolk" }],
    ] as const)
      doc = apply(doc, answer(c, a), p);
    doc = apply(doc, { type: "pool", step: "talents", picks: ["talent.legends", "talent.climbing"] }, p);
    const holder = Object.keys(doc.answers).find((c) =>
      JSON.stringify(doc.answers[c]).includes("talent.legends"),
    )!;
    const held = doc.answers[holder] as { pick?: string; picks?: string[] };
    doc = apply(
      doc,
      answer(holder, { ...held, texts: { "talent.legends": { tale: "The Drowned Bell" } } }),
      p,
    );
    doc = apply(
      doc,
      { type: "pool", step: "talents", picks: ["talent.climbing", "talent.mending", "talent.legends"] },
      p,
    );
    const ev = evaluateDraft(p, doc);
    expect(ev.things.find((t) => t.id === "talent.legends")!.texts).toEqual(["The Drowned Bell"]);
  });
});
