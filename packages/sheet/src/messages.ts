/**
 * The builder's own words on paper: page furniture that no package
 * provides ("page 1 of 2", "played by"). Everything about the game itself
 * comes from the package. One language per document, never mixed: a
 * language without an entry here cannot be printed.
 */

export interface Messages {
  playedBy: string;
  /** What the first place of a row holds, for a screen reader: the row's name. */
  rowName: string;
  /** Small in the corner of a field the player fills in by hand: what goes there and with what. */
  pencil: string;
  /** Hint under a pencil box: the value to start with. */
  startValue: (n: string) => string;
  /** Character without a name yet. */
  unnamed: string;
  page: (n: number, of: number) => string;
  /** Footer: which units the document uses, e.g. "meters, kilograms". */
  unitsUsed: (units: string[]) => string;
  createdOn: (date: string) => string;
  /** Name of a copy of the sheet the player keeps, until they give it one. */
  copyName: (date: string) => string;
  /** The copy as the screen and the PDF name it: when it was made, to the minute. */
  copyNameAt: (date: string, time: string) => string;
  /** The copy in a file name, without characters a file system refuses ("Version October 7 09-40"). */
  copyFile: (date: string, time: string) => string;
  /** Footer of a kept copy: the level of the original it was made from. */
  asOfLevel: (level: number) => string;
  cards: string;
  printHint: string;
  atTheTable: string;
  rulesText: string;
  continued: string;
  continuesOnNextCard: string;
  yes: string;
  no: string;
  /** "8 × Rope": how many of a thing the character has. */
  count: (n: string, name: string) => string;
  /** The parts of a printout, as in a file name ("Mira - Sheet.pdf"). */
  sheet: string;
  rulesTexts: string;
  /** Title of the rules texts part. */
  rulesTextsTitle: string;
  /** The rules texts part of a character that has no thing with a text. */
  noRulesTexts: string;
}

export const MESSAGES: Readonly<Record<string, Messages>> = {
  de: {
    playedBy: "Gespielt von",
    rowName: "Name",
    pencil: "Aktuell, mit Bleistift:",
    startValue: (n) => `Startwert ${n}`,
    unnamed: "Ohne Namen",
    page: (n, of) => `Seite ${n} von ${of}`,
    unitsUsed: (u) => `Einheiten: ${u.join(", ")}`,
    copyName: (d) => `Meine Fassung vom ${d}`,
    copyNameAt: (d, t) => `Meine Fassung vom ${d}, ${t}`,
    copyFile: (d, t) => `Fassung ${d} ${t.replace(/:/g, "-")}`,
    asOfLevel: (n) => `Stand Stufe ${n}`,
    createdOn: (d) => `Erstellt am ${d}`,
    cards: "Karten",
    printHint: "In Originalgrösse (100 %) drucken. An den Linien ausschneiden.",
    atTheTable: "Am Tisch",
    rulesText: "Regeltext",
    continued: "Fortsetzung",
    continuesOnNextCard: "weiter auf der nächsten Karte",
    yes: "ja",
    no: "nein",
    count: (n, name) => `${n} × ${name}`,
    sheet: "Bogen",
    rulesTexts: "Regeltexte",
    rulesTextsTitle: "Regeltexte zum Nachlesen",
    noRulesTexts: "Dieser Charakter hat nichts mit einem Regeltext.",
  },
  en: {
    playedBy: "Played by",
    rowName: "Name",
    pencil: "Current, in pencil:",
    startValue: (n) => `Start at ${n}`,
    unnamed: "No name yet",
    page: (n, of) => `Page ${n} of ${of}`,
    unitsUsed: (u) => `Units: ${u.join(", ")}`,
    copyName: (d) => `My version of ${d}`,
    copyNameAt: (d, t) => `My version of ${d}, ${t}`,
    copyFile: (d, t) => `Version ${d} ${t.replace(/:/g, "-")}`,
    asOfLevel: (n) => `as of level ${n}`,
    createdOn: (d) => `Made on ${d}`,
    cards: "Cards",
    printHint: "Print at actual size (100%). Cut along the lines.",
    atTheTable: "At the table",
    rulesText: "Rules text",
    continued: "Continued",
    continuesOnNextCard: "continues on the next card",
    yes: "yes",
    no: "no",
    count: (n, name) => `${n} × ${name}`,
    sheet: "Sheet",
    rulesTexts: "Rules texts",
    rulesTextsTitle: "Rules texts to read up on",
    noRulesTexts: "This character has nothing with a rules text.",
  },
};

export const PRINT_LANGUAGES = Object.keys(MESSAGES);
