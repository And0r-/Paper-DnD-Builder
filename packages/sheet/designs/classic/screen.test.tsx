/**
 * The screen of "classic" shows what the model has, in the design's order
 * (`classicPlan`): every section but the help box, every place to write or
 * tick (the play state's field ids), every text through the screen's
 * `Text`. Drawn to HTML on the server with stand-ins for the screen's
 * parts, so only the design is tested.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetModel, playFields, textAt, type SheetModel } from "../../src/index.ts";
import { demoCharacter, loadDemoPackage, raisedCharacter } from "../../src/testing.ts";
import type { SheetUi } from "../types.ts";
import { classicPlan, clusterRows } from "./index.ts";
import { ClassicSheet } from "./screen.tsx";

let models: SheetModel[];

beforeAll(async () => {
  const pkg = await loadDemoPackage();
  const doc = demoCharacter(pkg, 3);
  const createdAt = new Date("2026-10-04T12:00:00Z");
  models = [3, 20].flatMap((level) =>
    ["de", "en"].map((language) =>
      buildSheetModel(pkg, level === 3 ? doc : raisedCharacter(pkg, doc, level), { language, createdAt }),
    ),
  );
});

const ui: SheetUi = {
  Text: ({ path, value }) => <span data-path={JSON.stringify(path)}>{value}</span>,
  Field: ({ field }) => (
    <span data-field={field.id} data-kind={field.kind} data-max={field.kind === "ticks" ? field.max : ""} />
  ),
  AddRow: ({ section }) => <button data-add={section} />,
  RemoveRow: ({ section, row }) => <button data-remove={`${section}/${row}`} />,
};

const all = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))].map((m) => m[1]!.replaceAll("&quot;", '"'));

/** The model with its sections in the design's order and boxes in the design's rows, help boxes left out. */
function inDesignOrder(model: SheetModel): SheetModel {
  const sections = classicPlan(model.sections).order.map((i) => {
    const s = model.sections[i]!;
    return s.kind === "statBoxes" ? { ...s, boxes: clusterRows(s.boxes).flatMap((r) => r.boxes) } : s;
  });
  return { ...model, sections };
}

describe("classic on screen", () => {
  it("shows the sections in the design's order, which follows kinds and the package's order only", () => {
    for (const model of models) {
      const html = renderToStaticMarkup(<ClassicSheet model={model} ui={ui} />);
      const plan = classicPlan(model.sections);
      expect(all(html, "data-section")).toEqual(plan.order.map((i) => model.sections[i]!.id));
      // Every section but the help box; the help box stays in the model.
      const hidden = model.sections.filter((s) => s.kind === "helpBox").map((s) => s.id);
      expect(hidden.length).toBeGreaterThan(0);
      for (const id of hidden) expect(all(html, "data-section")).not.toContain(id);
      expect(all(html, "data-section").length).toBe(model.sections.length - hidden.length);
    }
  });

  it("places by kind and order: the boxes before the scores at the table, those after them beside the checks", () => {
    const kinds = (ids: number[], model: SheetModel) => ids.map((i) => model.sections[i]!.kind);
    for (const model of models) {
      const { parts } = classicPlan(model.sections);
      const scoresAt = model.sections.findIndex((s) => s.kind === "scoreColumn");
      expect(parts.scores).toEqual([scoresAt]);
      expect(parts.cluster.every((i) => i < scoresAt && model.sections[i]!.kind === "statBoxes")).toBe(true);
      expect(parts.side.every((i) => i > scoresAt && model.sections[i]!.kind === "statBoxes")).toBe(true);
      expect(new Set(kinds(parts.checks, model))).toEqual(new Set(["checkList"]));
      expect(new Set(kinds(parts.right, model))).toEqual(new Set(["statTable", "featureTable"]));
      expect(new Set(kinds(parts.band, model))).toEqual(new Set(["list"]));
      expect(new Set(kinds(parts.later, model))).toEqual(new Set(["answers", "notes"]));
    }
  });

  it("has every place to write or tick of the model, once, of its kind", () => {
    for (const model of models) {
      const html = renderToStaticMarkup(<ClassicSheet model={model} ui={ui} />);
      const fields = playFields(inDesignOrder(model));
      expect(all(html, "data-field")).toEqual(fields.map((f) => f.id));
      expect(all(html, "data-kind")).toEqual(fields.map((f) => f.kind));
      expect(all(html, "data-max")).toEqual(fields.map((f) => (f.kind === "ticks" ? String(f.max) : "")));
      expect([...all(html, "data-field")].sort()).toEqual(
        playFields(model)
          .map((f) => f.id)
          .sort(),
      );
    }
  });

  it("hands every text it shows to the screen at a path that holds that text", () => {
    for (const model of models) {
      const html = renderToStaticMarkup(<ClassicSheet model={model} ui={ui} />);
      const paths = all(html, "data-path").map((p) => JSON.parse(p) as (string | number)[]);
      expect(paths.length).toBeGreaterThan(50);
      for (const path of paths) expect(textAt(model, path), JSON.stringify(path)).toBeDefined();
    }
  });

  it("shows titles and short lines, no hints", () => {
    for (const model of models) {
      const html = renderToStaticMarkup(<ClassicSheet model={model} ui={ui} />);
      const paths = all(html, "data-path").map((p) => JSON.parse(p) as (string | number)[]);
      // The one hint shown is the start value of a pencil box, written on its line.
      const hints = paths.filter((p) => p.at(-1) === "hint");
      for (const p of hints) expect(textAt(model, [...p.slice(0, -1), "style"])).toBe("pencil");
      for (const s of model.sections) if (s.hint !== "") expect(html).not.toContain(s.hint);
    }
  });

  it("offers rows to add and cross out only where the model has rows", () => {
    const model = models[3]!;
    const html = renderToStaticMarkup(<ClassicSheet model={model} ui={ui} />);
    const kinds = all(html, "data-add").map((i) => model.sections[Number(i)]!.kind);
    expect(new Set(kinds)).toEqual(new Set(["list", "statTable", "featureTable"]));
  });

  it("is written in the model's language only", () => {
    const html = renderToStaticMarkup(<ClassicSheet model={models[1]!} ui={ui} />);
    expect(html).toContain('lang="en"');
    expect(html).not.toMatch(/Gespielt von|Aktuell, mit Bleistift/);
  });
});
