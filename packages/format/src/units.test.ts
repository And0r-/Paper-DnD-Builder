import { describe, expect, it } from "vitest";
import type { Units } from "./schema.ts";
import { convertAmount, dimensionOf } from "./units.ts";

const units: Units = {
  dimensions: { length: { source: "ft", units: ["ft", "m"] } },
  languageDefaults: { de: { length: "m" } },
  conversions: [
    {
      from: "ft",
      to: "m",
      table: [
        [5, 1.5],
        [30, 9],
      ],
      fallback: { factor: 0.3, step: 0.5 },
    },
    { from: "m", to: "ft", table: [[1.5, 5]] },
  ],
};

describe("convertAmount", () => {
  it("uses the table, not arithmetic", () => {
    expect(convertAmount(units, 5, "ft", "m")).toBe(1.5);
    expect(convertAmount(units, 30, "ft", "m")).toBe(9);
  });

  it("uses the declared fallback only for amounts missing from the table", () => {
    expect(convertAmount(units, 25, "ft", "m")).toBe(7.5);
    expect(convertAmount(units, 45, "ft", "m")).toBe(13.5);
  });

  it("returns undefined when the package gives no way to convert", () => {
    expect(convertAmount(units, 3, "m", "ft")).toBeUndefined();
    expect(convertAmount(units, 3, "ft", "lb")).toBeUndefined();
  });

  it("returns the amount unchanged for the same unit", () => {
    expect(convertAmount(units, 7, "m", "m")).toBe(7);
  });
});

describe("dimensionOf", () => {
  it("finds the dimension of a unit", () => {
    expect(dimensionOf(units, "m")).toBe("length");
    expect(dimensionOf(units, "kg")).toBeUndefined();
  });
});
