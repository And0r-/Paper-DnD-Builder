import { PRINT_LANGUAGES } from "@builder/sheet";
import { describe, expect, it } from "vitest";
import { fill, MESSAGES, pickLanguage, translator, UI_LANGUAGES } from "./index.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("screen texts", () => {
  const [first, ...rest] = UI_LANGUAGES;
  const base = MESSAGES[first];

  it.each(rest)("%s has exactly the keys of the first language", (lang) => {
    expect(Object.keys(MESSAGES[lang]).sort()).toEqual(Object.keys(base).sort());
  });

  it.each(UI_LANGUAGES)("%s: no empty texts, same placeholders as the first language", (lang) => {
    for (const [key, text] of Object.entries(MESSAGES[lang])) {
      expect(text.trim(), key).not.toBe("");
      expect(placeholders(text), key).toEqual(placeholders(base[key as keyof typeof base]));
    }
  });

  it("every counted text has both forms", () => {
    for (const key of Object.keys(base)) {
      if (key.endsWith(".one")) expect(base).toHaveProperty(key.replace(/\.one$/, ".other"));
      if (key.endsWith(".other")) expect(base).toHaveProperty(key.replace(/\.other$/, ".one"));
    }
  });

  it("fills placeholders with numbers in the language's format", () => {
    expect(fill("{n} m", "de", { n: 1.5 })).toBe("1,5 m");
    expect(fill("{n} ft", "en", { n: 1.5 })).toBe("1.5 ft");
  });

  it("starts a text that opens with a placeholder with a capital", () => {
    expect(fill("{levelName} : monter", "fr", { levelName: "niveau" })).toBe("Niveau : monter");
    expect(fill("Monter de {levelName}", "fr", { levelName: "niveau" })).toBe("Monter de niveau");
    expect(fill("{levelName} {level}", "en", { levelName: "level", level: 3 })).toBe("Level 3");
  });

  it("elides a French de, le, la or que before a filled word with a vowel", () => {
    expect(fill("de {source}", "fr", { source: "Armure Lanterne" })).toBe("d’Armure Lanterne");
    expect(fill("De {source}", "fr", { source: "Équipement de départ" })).toBe("D’Équipement de départ");
    expect(fill("{n} de {source}", "fr", { n: 16, source: "Origine" })).toBe("16 d’Origine");
    expect(fill("avec le {levelName}", "fr", { levelName: "échelon" })).toBe("avec l’échelon");
    expect(fill("parce que {name} part", "fr", { name: "Iris" })).toBe("parce qu’Iris part");
    // Not before a consonant, not before "h" (it depends on the word), not inside a word, not in Italian.
    expect(fill("de {source}", "fr", { source: "Classe" })).toBe("de Classe");
    expect(fill("de {source}", "fr", { source: "Hache" })).toBe("de Hache");
    expect(fill("garde {name}", "fr", { name: "Iris" })).toBe("garde Iris");
    expect(fill("de {n}", "fr", { n: 8 })).toBe("de 8");
    expect(fill("de {source}", "it", { source: "Armatura" })).toBe("de Armatura");
  });

  it("French speaks to the reader with vous, never with tu", () => {
    const tu = /(^|[^\p{L}])(tu|te|toi|ton|ta|tes|t’)(?![\p{L}])/iu;
    for (const [key, text] of Object.entries(MESSAGES.fr)) expect(text, key).not.toMatch(tu);
  });

  it("counts and lists", () => {
    const de = translator("de");
    expect(de.tc("dist.left", 1)).toBe("Noch 1 Punkt übrig");
    expect(de.tc("dist.left", 4)).toBe("Noch 4 Punkte übrig");
    expect(de.list(["A", "B", "C"])).toBe("A, B und C");
    expect(translator("en").list(["A", "B"])).toBe("A and B");
    expect(translator("fr").list(["A", "B", "C"])).toBe("A, B et C");
    expect(translator("it").list(["A", "B"])).toBe("A e B");
    expect(translator("es").list(["A", "B"])).toBe("A y B");
  });

  it("has all five languages", () => {
    expect([...UI_LANGUAGES].sort()).toEqual(["de", "en", "es", "fr", "it"]);
  });

  it("offers only languages the sheet and the PDF have page words for", () => {
    expect(PRINT_LANGUAGES).toEqual(expect.arrayContaining([...UI_LANGUAGES]));
  });

  it("picks the language from Accept-Language", () => {
    expect(pickLanguage("en-GB,en;q=0.9,de;q=0.8")).toBe("en");
    expect(pickLanguage("fr-FR,de;q=0.5")).toBe("fr");
    expect(pickLanguage("it-CH,it;q=0.9")).toBe("it");
    expect(pickLanguage("es-419,es;q=0.9,en;q=0.5")).toBe("es");
    expect(pickLanguage("pt-BR,es;q=0.7")).toBe("es");
    expect(pickLanguage("pt")).toBe("de");
    expect(pickLanguage(null)).toBe("de");
  });

  it.each(UI_LANGUAGES)("%s: no word of English left where another language is meant", (lang) => {
    if (lang === "en") return;
    // A text the same as in English is fine only when it is a name or a short technical word.
    const same = Object.entries(MESSAGES[lang]).filter(
      ([key, text]) => text === MESSAGES.en[key as keyof typeof base] && /\p{L}{5,}\s\p{L}{3,}/u.test(text),
    );
    expect(same.map(([k]) => k)).toEqual([]);
  });
});
