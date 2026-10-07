import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir } from "@builder/format";
import { describe, expect, it } from "vitest";
import { UI_LANGUAGES } from "../i18n/index.ts";
import type { PackageListEntry } from "./api.ts";
import { offeredLanguages } from "./packages.ts";

const entry = (id: string, languages: string[]): PackageListEntry => ({
  id,
  version: "1.0.0",
  languages,
  language: languages[0]!,
  name: null,
  short: null,
});

describe("languages offered by the language switch", () => {
  it("are the demo package's languages", async () => {
    const pkg = (await validatePackageDir(DEMO_PACKAGE_DIR)).package!;
    const demo = entry("demo", pkg.manifest.languages);
    expect(offeredLanguages(UI_LANGUAGES, [demo])).toEqual(["de", "en"]);
  });

  it("leave out a language one installed package lacks", () => {
    expect(offeredLanguages(UI_LANGUAGES, [entry("a", ["de", "en"]), entry("b", ["en"])])).toEqual(["en"]);
  });

  it("leave out a package language the builder has no screen texts for", () => {
    expect(offeredLanguages(UI_LANGUAGES, [entry("a", ["en", "xx", "de"])])).toEqual(["de", "en"]);
  });

  it("keep the builder's languages when no package is installed", () => {
    expect(offeredLanguages(UI_LANGUAGES, [])).toEqual(["de", "en"]);
  });
});
