/**
 * The builder's own words on paper: page furniture that no package
 * provides ("page 1 of 2", "played by"). Everything about the game itself
 * comes from the package. One language per document, never mixed: a
 * language without an entry here cannot be printed.
 */

export interface Messages {
  playedBy: string;
  /** Shown in a box the player fills in by hand. */
  pencil: string;
  /** Hint under a pencil box: the value to start with. */
  startValue: (n: string) => string;
  /** Character without a name yet. */
  unnamed: string;
  page: (n: number, of: number) => string;
  /** Footer: which units the document uses, e.g. "meters, kilograms". */
  unitsUsed: (units: string[]) => string;
  createdOn: (date: string) => string;
  cards: string;
  printHint: string;
  atTheTable: string;
  rulesText: string;
  continued: string;
  continuesOnNextCard: string;
  yes: string;
  no: string;
}

export const MESSAGES: Readonly<Record<string, Messages>> = {
  de: {
    playedBy: "Gespielt von",
    pencil: "Bleistift",
    startValue: (n) => `Startwert ${n}`,
    unnamed: "Ohne Namen",
    page: (n, of) => `Seite ${n} von ${of}`,
    unitsUsed: (u) => `Einheiten: ${u.join(", ")}`,
    createdOn: (d) => `Erstellt am ${d}`,
    cards: "Karten",
    printHint: "In Originalgrösse (100 %) drucken. An den Linien ausschneiden.",
    atTheTable: "Am Tisch",
    rulesText: "Regeltext",
    continued: "Fortsetzung",
    continuesOnNextCard: "weiter auf der nächsten Karte",
    yes: "ja",
    no: "nein",
  },
  en: {
    playedBy: "Played by",
    pencil: "Pencil",
    startValue: (n) => `Start at ${n}`,
    unnamed: "No name yet",
    page: (n, of) => `Page ${n} of ${of}`,
    unitsUsed: (u) => `Units: ${u.join(", ")}`,
    createdOn: (d) => `Made on ${d}`,
    cards: "Cards",
    printHint: "Print at actual size (100%). Cut along the lines.",
    atTheTable: "At the table",
    rulesText: "Rules text",
    continued: "Continued",
    continuesOnNextCard: "continues on the next card",
    yes: "yes",
    no: "no",
  },
};

export const PRINT_LANGUAGES = Object.keys(MESSAGES);
