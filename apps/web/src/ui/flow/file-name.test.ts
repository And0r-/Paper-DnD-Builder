import { describe, expect, it } from "vitest";
import { fileNames } from "../../server/api/routes/print.ts";
import { fileNameOf } from "./file-name.ts";

/** What the server sends, read the way the download dialog reads it: through a fetch Response's headers. */
const saved = (parts: string[]) =>
  fileNameOf(
    new Response("%PDF-", { headers: { "Content-Disposition": fileNames(parts) } }).headers.get(
      "content-disposition",
    ),
    "fallback.pdf",
  );

describe("the name a PDF is saved under", () => {
  it.each([
    [["Mira", "Ausführlich", "Bogen, Karten"], "Mira - Ausführlich - Bogen, Karten.pdf"],
    [["Mira", "Klassisch", "Bogen"], "Mira - Klassisch - Bogen.pdf"],
    [["Mira", "Detailed", "Sheet, Cards"], "Mira - Detailed - Sheet, Cards.pdf"],
    [
      ["Jörg Übermut", "Fassung 7. Oktober 15-56", "Ausführlich", "Bogen"],
      "Jörg Übermut - Fassung 7. Oktober 15-56 - Ausführlich - Bogen.pdf",
    ],
    [["Zoë D'Arcy (die Zweite)*"], "Zoë D'Arcy (die Zweite)*.pdf"],
    [["Mira; Ausführlich"], "Mira; Ausführlich.pdf"],
    [["Ἀλκμήνη", "名前"], "Ἀλκμήνη - 名前.pdf"],
  ])("%j is saved as %s, with .pdf", (parts, name) => {
    expect(saved(parts)).toBe(name);
  });

  it("sends a header of ASCII only, with every reserved character of RFC 5987 encoded", () => {
    const header = fileNames(["Zoë D'Arcy (die Zweite)*", "Ausführlich"]);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    const ext = /filename\*=UTF-8''(.+)$/.exec(header)![1]!;
    expect(ext).toMatch(/^[A-Za-z0-9!#$&+.^_`|~%-]+$/);
  });

  it("falls back without a usable filename*", () => {
    expect(fileNameOf(null, "Mira.pdf")).toBe("Mira.pdf");
    expect(fileNameOf('attachment; filename="Mira.pdf"', "Mira.pdf")).toBe("Mira.pdf");
    expect(fileNameOf("attachment; filename*=UTF-8''%E0%A4%A", "Mira.pdf")).toBe("Mira.pdf");
  });
});
