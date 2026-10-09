import { beforeAll, describe, expect, it } from "vitest";
import type { ContentPackage } from "@builder/format";
import { buildSheetModel, type SheetModel } from "./index.ts";
import { footerWords } from "./footer.ts";
import { MESSAGES } from "./messages.ts";
import { demoCharacter, loadDemoPackage } from "./testing.ts";

let pkg: ContentPackage;
beforeAll(async () => {
  pkg = await loadDemoPackage();
});

const copyOf = (model: SheetModel, createdAt: string): SheetModel => ({
  ...model,
  origin: {
    kind: "copy",
    name: "Meine Fassung vom 7. Oktober 2026",
    createdAt,
    fromLevel: 3,
    fromPackageVersion: "1",
  },
});

describe("footer words", () => {
  it("name a kept copy by the minute it was made, as its PDF does", () => {
    const model = buildSheetModel(pkg, demoCharacter(pkg, 3), { language: "de" });
    const at = new Date(2026, 9, 7, 13, 15);
    const { rest } = footerWords(copyOf(model, at.toISOString()), 1, 2);
    expect(rest[0]).toMatch(/^Meine Fassung vom 7\. Oktober( 2026)?, 13:15$/u);
    // The PDF names the copy itself.
    expect(footerWords(copyOf(model, at.toISOString()), 1, 2, "Kopie").rest[0]).toBe("Kopie");
  });

  it("count all the PDF's pages there, and the sheet's alone on screen, saying so", () => {
    const model = buildSheetModel(pkg, demoCharacter(pkg, 3), { language: "de" });
    expect(footerWords(model, 1, 11).rest.at(-1)).toBe("Seite 1 von 11");
    expect(footerWords(model, 1, 5, undefined, "sheet").rest.at(-1)).toBe("Bogen, Seite 1 von 5");
    // Every language: the screen's words name the sheet and end as the PDF's do.
    for (const m of Object.values(MESSAGES)) {
      expect(m.sheetPage(2, 5)).not.toBe(m.page(2, 5));
      expect(m.sheetPage(2, 5).endsWith(m.page(2, 5).slice(1))).toBe(true);
    }
  });
});
