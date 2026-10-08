import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir } from "@builder/format";
import { describe, expect, it } from "vitest";
import { UI_LANGUAGES } from "../i18n/index.ts";
import type { PackageListEntry, PackageStructure } from "./api.ts";
import { offeredLanguages, packageLanguage } from "./packages.ts";

const entry = (id: string, languages: string[]): PackageListEntry => ({
  id,
  version: "1.0.0",
  languages,
  language: languages[0]!,
  extensions: [],
  name: null,
  short: null,
});

describe("languages offered by the language switch", () => {
  it("are all five with the demo package: what it lacks falls back to English", async () => {
    const pkg = (await validatePackageDir(DEMO_PACKAGE_DIR)).package!;
    const demo = entry("demo", pkg.manifest.languages);
    expect(offeredLanguages(UI_LANGUAGES, [demo])).toEqual(["de", "en", "fr", "it", "es"]);
  });

  it("leave out a language one installed package has neither itself nor in English", () => {
    expect(offeredLanguages(UI_LANGUAGES, [entry("a", ["de", "en"]), entry("b", ["de"])])).toEqual(["de"]);
    expect(offeredLanguages(UI_LANGUAGES, [entry("a", ["fr", "en"]), entry("b", ["fr", "de"])])).toEqual([
      "de",
      "fr",
    ]);
  });

  it("leave out a package language the builder has no screen texts for", () => {
    expect(offeredLanguages(UI_LANGUAGES, [entry("a", ["xx", "de"])])).toEqual(["de"]);
  });

  it("keep the builder's languages when no package is installed", () => {
    expect(offeredLanguages(UI_LANGUAGES, [])).toEqual(["de", "en", "fr", "it", "es"]);
  });
});

describe("the language a package is shown in", () => {
  const structure = (languages: string[]) => ({ manifest: { languages } }) as unknown as PackageStructure;

  it("is the screen language if the package has it, else English, else its first", () => {
    expect(packageLanguage(structure(["de", "en", "fr"]), "fr")).toBe("fr");
    expect(packageLanguage(structure(["de", "en"]), "fr")).toBe("en");
    expect(packageLanguage(structure(["de", "it"]), "fr")).toBe("de");
  });
});
