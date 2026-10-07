import { beforeAll, describe, expect, it } from "vitest";
import type { ContentPackage } from "@builder/format";
import { buildSheetModel, type SheetModel } from "./index.ts";
import { footerWords } from "./footer.ts";
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
});
