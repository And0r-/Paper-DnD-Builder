import { describe, expect, it } from "vitest";
import { contentBottom } from "../geometry.ts";
import { packSections, VERBOSE_GEOMETRY as G } from "./index.ts";

describe("packSections: the PDF's placing rule for the screen", () => {
  const room = contentBottom(G) - G.margin;

  it("puts a short section beside a tall one, never above the one before", () => {
    const at = packSections([
      { span: 8, height: 100 },
      { span: 4, height: 30 },
      { span: 12, height: 20 },
    ]);
    expect(at[0]).toEqual({ page: 0, col: 0, y: G.margin });
    expect(at[1]).toEqual({ page: 0, col: 8, y: G.margin });
    expect(at[2]!.y).toBeGreaterThanOrEqual(G.margin + 100);
  });

  it("starts the next page where a section no longer fits", () => {
    const at = packSections([
      { span: 12, height: room - 20 },
      { span: 12, height: 40 },
    ]);
    expect(at[1]).toEqual({ page: 1, col: 0, y: G.margin + G.continuationHead });
  });

  it("keeps a section that runs past the foot by no more than the slack", () => {
    const sections = [
      { span: 12, height: room - 20 },
      { span: 12, height: 40 },
    ];
    expect(packSections(sections, G, 85, 30)[1]!.page).toBe(0);
    expect(packSections(sections, G, 85, 20)[1]!.page).toBe(1);
  });
});
