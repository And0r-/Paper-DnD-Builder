import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import { effectiveUnits, formatMeasure, renderText, type MeasureContext } from "./index.ts";

let pkg: ContentPackage;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  pkg = r.package;
});

const ctx = (language: string, preferred: Record<string, string> = {}): MeasureContext => ({
  units: pkg.units,
  texts: pkg.texts[language]!,
  language,
  preferred,
});

describe("effectiveUnits", () => {
  it("starts from the package's default for the language", () => {
    expect(effectiveUnits(pkg.units, "de")).toEqual({ length: "m", weight: "kg" });
    expect(effectiveUnits(pkg.units, "en")).toEqual({ length: "ft", weight: "lb" });
  });

  it("lets the account choose per dimension, independent of the language", () => {
    expect(effectiveUnits(pkg.units, "de", { length: "ft" })).toEqual({ length: "ft", weight: "kg" });
  });

  it("ignores a unit the package does not offer for that dimension", () => {
    expect(effectiveUnits(pkg.units, "en", { length: "kg", volume: "l" })).toEqual({
      length: "ft",
      weight: "lb",
    });
  });
});

describe("formatMeasure", () => {
  it("converts by the package's table, not by math", () => {
    expect(formatMeasure(ctx("de"), { amount: 5, unit: "ft" }, "short")).toBe("1,5 m");
    expect(formatMeasure(ctx("de"), { amount: 30, unit: "ft" })).toBe("9 Meter");
    expect(formatMeasure(ctx("de"), { amount: 25, unit: "ft" }, "short")).toBe("7,5 m");
  });

  it("uses the fallback rule for amounts missing from the table", () => {
    // 50 * 0.3 = 15, on a 0.5 step
    expect(formatMeasure(ctx("de"), { amount: 50, unit: "ft" }, "short")).toBe("15 m");
    expect(formatMeasure(ctx("de"), { amount: 45, unit: "lb" }, "short")).toBe("22,5 kg");
  });

  it("keeps the source unit when the reader uses it", () => {
    expect(formatMeasure(ctx("en"), { amount: 30, unit: "ft" })).toBe("30 feet");
    expect(formatMeasure(ctx("en"), { amount: 1, unit: "lb" })).toBe("1 pound");
    expect(formatMeasure(ctx("en", { length: "m" }), { amount: 5, unit: "ft" })).toBe("1.5 meters");
    expect(formatMeasure(ctx("de", { length: "ft" }), { amount: 25, unit: "ft" }, "short")).toBe("25 Fuss");
  });

  it("leaves amounts without a unit dimension alone", () => {
    expect(formatMeasure(ctx("en"), { amount: 3, unit: "turn" })).toBe("3 turn");
  });
});

describe("renderText", () => {
  it("fills quantities, variables and keeps glossary links apart", () => {
    const parts = renderText(
      ctx("de"),
      "Dein Tempo ist {{length:25}}, also {{length:25|short}}. Stufe {{var:level}}, [[glossary:pace|Tempo]]!",
      { level: 3 },
    );
    expect(parts).toEqual([
      { type: "text", text: "Dein Tempo ist 7,5 Meter, also 7,5 m. Stufe 3, " },
      { type: "glossary", id: "pace", text: "Tempo" },
      { type: "text", text: "!" },
    ]);
  });

  it("writes a signed variable with its sign, zero included", () => {
    const roll = (bonus: number) =>
      renderText(ctx("de"), "1W6 {{var:bonus|signed}}", { bonus })
        .map((p) => p.text)
        .join("");
    expect([roll(3), roll(0), roll(-1)]).toEqual(["1W6 +3", "1W6 +0", "1W6 -1"]);
  });

  it("renders the demo package's own texts", () => {
    const parts = renderText(ctx("en"), pkg.texts["en"]!["trait.quick-feet.explain.table"] as string);
    expect(parts.map((p) => p.text).join("")).toContain("5 feet");
  });
});
