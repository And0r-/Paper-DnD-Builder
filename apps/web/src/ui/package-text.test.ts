import { describe, expect, it } from "vitest";
import { translator } from "../i18n/index.ts";
import { distributeMethodLabels, grantedValue, isYesNoValue, measureContext } from "./package-text.ts";
import type { LoadedPackage } from "./packages.ts";

const de = translator("de");
const en = translator("en");

describe("names of the ways to distribute", () => {
  it("never shows two buttons with the same text for several fixed rows", () => {
    const methods = [
      { method: "array" as const, values: [2, 1, 0] },
      { method: "array" as const, values: [1, 1, 1] },
    ];
    const labels = distributeMethodLabels(methods, "de", de.t, de.list);
    expect(labels).toEqual(["Zahlen 2 und 1 vergeben", "Zahlen 1, 1 und 1 vergeben"]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(distributeMethodLabels(methods, "en", en.t, en.list)).toEqual([
      "Give out 2 and 1",
      "Give out 1, 1 and 1",
    ]);
  });

  it("keeps the short names when they are already different", () => {
    const methods = [{ method: "pointBuy" as const }, { method: "array" as const, values: [8, 7, 7, 6] }];
    expect(distributeMethodLabels(methods, "de", de.t, de.list)).toEqual([
      "Punkte verteilen",
      "Feste Zahlen zuordnen",
    ]);
  });
});

describe("what you get", () => {
  const lp = {
    lang: "de",
    texts: { "value.trained.name": "Geübt im Klettern", "value.stamina.name": "Ausdauer" },
    pkg: {
      units: [],
      values: [
        { id: "trained", source: "s", default: 0, max: 1 },
        { id: "stamina", source: "s", default: 4 },
        { id: "capped", source: "s", min: 0, max: 1, formula: "1" },
      ],
    },
  } as unknown as LoadedPackage;
  const ctx = measureContext(lp, undefined);

  it("shows a yes/no value by its name only, without +1", () => {
    expect(isYesNoValue(lp, "trained")).toBe(true);
    expect(grantedValue(lp, ctx, "trained", 1)).toBe("Geübt im Klettern");
  });

  it("keeps the number for real numbers", () => {
    expect(isYesNoValue(lp, "stamina")).toBe(false);
    expect(isYesNoValue(lp, "capped")).toBe(false);
    expect(grantedValue(lp, ctx, "stamina", 15)).toBe("Ausdauer +15");
  });
});
