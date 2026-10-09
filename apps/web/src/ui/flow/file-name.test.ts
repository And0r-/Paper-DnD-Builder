import { MESSAGES, SHEET_DESIGNS } from "@builder/sheet";
import { describe, expect, it } from "vitest";
import { UI_LANGUAGES } from "../../i18n/index.ts";
import { fileNames } from "../../server/api/routes/print.ts";
import { fileNameOf, portableFileName } from "./file-name.ts";

/** What the server sends, read the way the download dialog reads it: through a fetch Response's headers. */
const saved = (parts: string[], lang = "en") =>
  fileNameOf(
    new Response("%PDF-", { headers: { "Content-Disposition": fileNames(parts) } }).headers.get(
      "content-disposition",
    ),
    "fallback.pdf",
    lang,
  );

/** A name every browser writes to disk, whatever its locale: ASCII, no reserved character, ".pdf". */
const portable = /^[\x20-\x7e]+\.pdf$/;

describe("the name a PDF is saved under", () => {
  it.each([
    [["Mira", "Ausführlich", "Bogen, Karten"], "de", "Mira - Ausfuehrlich - Bogen, Karten.pdf"],
    [["Mira", "Klassisch", "Bogen"], "de", "Mira - Klassisch - Bogen.pdf"],
    [["Mira", "Detailed", "Sheet, Cards"], "en", "Mira - Detailed - Sheet, Cards.pdf"],
    [
      ["Jörg Übermut", "Fassung 7. Oktober 15-56", "Ausführlich", "Bogen"],
      "de",
      "Joerg Uebermut - Fassung 7. Oktober 15-56 - Ausfuehrlich - Bogen.pdf",
    ],
    [["Mathis", "Détaillée", "Fiche, Cartes"], "fr", "Mathis - Detaillee - Fiche, Cartes.pdf"],
    [["Gaëlle Sœur-d’Épée", "Classique", "Fiche"], "fr", "Gaelle Soeur-d'Epee - Classique - Fiche.pdf"],
    [
      ["Ñandú Çelik", "Versión 9 de octubre 07-23", "Clásica"],
      "es",
      "Nandu Celik - Version 9 de octubre 07-23 - Clasica.pdf",
    ],
    [["Zoë D'Arcy (die Zweite)*"], "de", "Zoe D'Arcy (die Zweite)-.pdf"],
    [["Mira; Ausführlich"], "de", "Mira; Ausfuehrlich.pdf"],
    [["Ἀλκμήνη", "Sheet"], "en", "Sheet.pdf"],
  ])("%j (%s) is saved as %s", (parts, lang, name) => {
    expect(saved(parts, lang)).toBe(name);
  });

  // The French file was saved as "download", without ".pdf": "Détaillée" has a letter beyond ASCII.
  it.each(UI_LANGUAGES)("in %s, every design and every part makes a portable name", (lang) => {
    const m = MESSAGES[lang]!;
    for (const design of SHEET_DESIGNS) {
      for (const parts of [[m.sheet], [m.sheet, m.cards], [m.sheet, m.cards, m.rulesTexts], [m.cards]]) {
        const name = saved(
          ["Élodie Müller-Ñúñez", m.copyFile("9 oct.", "07:23"), design.name[lang]!, parts.join(", ")],
          lang,
        );
        expect(name).toMatch(portable);
        expect(name).toContain(" - ");
      }
    }
  });

  it("sends a header of ASCII only, with every reserved character of RFC 5987 encoded", () => {
    const header = fileNames(["Zoë D'Arcy (die Zweite)*", "Ausführlich"]);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    const ext = /filename\*=UTF-8''(.+)$/.exec(header)![1]!;
    expect(ext).toMatch(/^[A-Za-z0-9!#$&+.^_`|~%-]+$/);
  });

  it("falls back without a usable filename*, and without any letter left", () => {
    expect(fileNameOf(null, "Mira.pdf")).toBe("Mira.pdf");
    expect(fileNameOf('attachment; filename="Mira.pdf"', "Mira.pdf")).toBe("Mira.pdf");
    expect(fileNameOf("attachment; filename*=UTF-8''%E0%A4%A", "Mira.pdf")).toBe("Mira.pdf");
    expect(fileNameOf(`attachment; filename*=UTF-8''${encodeURIComponent("名前.pdf")}`, "名前.pdf")).toBe(
      "character.pdf",
    );
    expect(portableFileName("名前 - 名前.pdf", "en")).toBeUndefined();
  });
});
