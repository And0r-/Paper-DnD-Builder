/**
 * The screen of "verbose" shows what the model has, in the model's order:
 * every section, every place to write or tick (the play state's field
 * ids), every text through the screen's `Text`. Drawn to HTML on the
 * server with stand-ins for the screen's parts, so only the design is
 * tested.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetModel, playFields, textAt, type SheetModel } from "../../src/index.ts";
import { demoCharacter, loadDemoPackage, raisedCharacter } from "../../src/testing.ts";
import type { SheetUi } from "../types.ts";
import { VerboseSheet } from "./screen.tsx";

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

describe("verbose on screen", () => {
  it("shows the sections in the model's order", () => {
    for (const model of models) {
      const html = renderToStaticMarkup(<VerboseSheet model={model} ui={ui} />);
      expect(all(html, "data-section")).toEqual(model.sections.map((s) => s.id));
    }
  });

  it("has every place to write or tick of the model, in its order and of its kind", () => {
    for (const model of models) {
      const html = renderToStaticMarkup(<VerboseSheet model={model} ui={ui} />);
      const fields = playFields(model);
      expect(all(html, "data-field")).toEqual(fields.map((f) => f.id));
      expect(all(html, "data-kind")).toEqual(fields.map((f) => f.kind));
      expect(all(html, "data-max")).toEqual(fields.map((f) => (f.kind === "ticks" ? String(f.max) : "")));
    }
  });

  it("hands every text it shows to the screen at a path that holds that text", () => {
    for (const model of models) {
      const html = renderToStaticMarkup(<VerboseSheet model={model} ui={ui} />);
      const paths = all(html, "data-path").map((p) => JSON.parse(p) as (string | number)[]);
      expect(paths.length).toBeGreaterThan(50);
      for (const path of paths) expect(textAt(model, path), JSON.stringify(path)).toBeDefined();
    }
  });

  it("offers rows to add and cross out only where the model has rows", () => {
    const model = models[3]!;
    const html = renderToStaticMarkup(<VerboseSheet model={model} ui={ui} />);
    const kinds = all(html, "data-add").map((i) => model.sections[Number(i)]!.kind);
    expect(new Set(kinds)).toEqual(new Set(["list", "statTable", "featureTable"]));
  });

  it("is written in the model's language only", () => {
    const html = renderToStaticMarkup(<VerboseSheet model={models[1]!} ui={ui} />);
    expect(html).toContain('lang="en"');
    expect(html).not.toMatch(/Gespielt von|Aktuell, mit Bleistift/);
  });
});
