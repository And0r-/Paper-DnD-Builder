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
  /** Head of a character with more than one track: label of the track it began with. */
  startedAs: string;
  page: (n: number, of: number) => string;
  /**
   * Footer on screen: the screen shows the sheet alone, so its count says so
   * ("Sheet, page 1 of 5"). The PDF counts all its pages, cards and texts too.
   */
  sheetPage: (n: number, of: number) => string;
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
  /**
   * After the package's attribution: the character has content of an extension that is not
   * publishable (SPEC 17.7). Names where it comes from; sharing the character is fine (AND-330).
   */
  fromExtensions: (names: string) => string;
  /** A choice with no option that fits the character: it was not asked (on its feature's row, or as its answer). */
  nothingToChoose: string;
  /** Hint under the box of a value that adds up levels of tracks: the tracks the character has levels in. */
  fromLevelsAs: (tracks: string) => string;
}

export const MESSAGES: Readonly<Record<string, Messages>> = {
  de: {
    playedBy: "Gespielt von",
    rowName: "Name",
    pencil: "Aktuell, mit Bleistift:",
    startValue: (n) => `Startwert ${n}`,
    unnamed: "Ohne Namen",
    startedAs: "Angefangen als",
    page: (n, of) => `Seite ${n} von ${of}`,
    sheetPage: (n, of) => `Bogen, Seite ${n} von ${of}`,
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
    fromExtensions: (names) => `Enthält Inhalt aus ${names}.`,
    nothingToChoose: "Nichts zu wählen: Keine Möglichkeit passt zu diesem Charakter.",
    fromLevelsAs: (tracks) => `Aus deinen Stufen als ${tracks}.`,
  },
  en: {
    playedBy: "Played by",
    rowName: "Name",
    pencil: "Current, in pencil:",
    startValue: (n) => `Start at ${n}`,
    unnamed: "No name yet",
    startedAs: "Started as",
    page: (n, of) => `Page ${n} of ${of}`,
    sheetPage: (n, of) => `Sheet, page ${n} of ${of}`,
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
    fromExtensions: (names) => `Contains content from ${names}.`,
    nothingToChoose: "Nothing to choose: no option fits this character.",
    fromLevelsAs: (tracks) => `From your ${tracks} levels.`,
  },
  fr: {
    playedBy: "Joué par",
    rowName: "Nom",
    pencil: "Actuel, au crayon :",
    startValue: (n) => `Départ à ${n}`,
    unnamed: "Pas encore de nom",
    startedAs: "A débuté comme",
    page: (n, of) => `Page ${n} sur ${of}`,
    sheetPage: (n, of) => `Fiche, page ${n} sur ${of}`,
    unitsUsed: (u) => `Unités : ${u.join(", ")}`,
    copyName: (d) => `Ma version du ${d}`,
    copyNameAt: (d, t) => `Ma version du ${d}, ${t}`,
    copyFile: (d, t) => `Version ${d} ${t.replace(/:/g, "-")}`,
    asOfLevel: (n) => `état au niveau ${n}`,
    createdOn: (d) => `Créé le ${d}`,
    cards: "Cartes",
    printHint: "Imprimez en taille réelle (100 %). Découpez le long des lignes.",
    atTheTable: "À la table",
    rulesText: "Texte de règle",
    continued: "Suite",
    continuesOnNextCard: "suite sur la carte suivante",
    yes: "oui",
    no: "non",
    count: (n, name) => `${n} × ${name}`,
    sheet: "Fiche",
    rulesTexts: "Textes de règles",
    rulesTextsTitle: "Textes de règles à relire",
    noRulesTexts: "Ce personnage n’a rien avec un texte de règle.",
    fromExtensions: (names) =>
      `Contient du contenu ${/^[aeiouàâéèêîïôœ]/i.test(names) ? "d’" : "de "}${names}.`,
    nothingToChoose: "Rien à choisir : aucune option ne convient à ce personnage.",
    fromLevelsAs: (tracks) => `De vos niveaux ${/^[aeiouàâéèêîïôœ]/i.test(tracks) ? "d’" : "de "}${tracks}.`,
  },
  it: {
    playedBy: "Giocato da",
    rowName: "Nome",
    pencil: "Attuale, a matita:",
    startValue: (n) => `Si parte da ${n}`,
    unnamed: "Ancora senza nome",
    startedAs: "Ha iniziato come",
    page: (n, of) => `Pagina ${n} di ${of}`,
    sheetPage: (n, of) => `Scheda, pagina ${n} di ${of}`,
    unitsUsed: (u) => `Unità: ${u.join(", ")}`,
    copyName: (d) => `La mia versione del ${d}`,
    copyNameAt: (d, t) => `La mia versione del ${d}, ${t}`,
    copyFile: (d, t) => `Versione ${d} ${t.replace(/:/g, "-")}`,
    asOfLevel: (n) => `stato al livello ${n}`,
    createdOn: (d) => `Creato il ${d}`,
    cards: "Carte",
    printHint: "Stampa a grandezza reale (100%). Ritaglia lungo le linee.",
    atTheTable: "Al tavolo",
    rulesText: "Testo della regola",
    continued: "Continua",
    continuesOnNextCard: "continua sulla carta successiva",
    yes: "sì",
    no: "no",
    count: (n, name) => `${n} × ${name}`,
    sheet: "Scheda",
    rulesTexts: "Testi delle regole",
    rulesTextsTitle: "Testi delle regole da rileggere",
    noRulesTexts: "Questo personaggio non ha niente con un testo delle regole.",
    fromExtensions: (names) => `Contiene contenuti da ${names}.`,
    nothingToChoose: "Niente da scegliere: nessuna opzione è adatta a questo personaggio.",
    fromLevelsAs: (tracks) => `Dai tuoi livelli da ${tracks}.`,
  },
  es: {
    playedBy: "Jugado por",
    rowName: "Nombre",
    pencil: "Actual, a lápiz:",
    startValue: (n) => `Empieza en ${n}`,
    unnamed: "Aún sin nombre",
    startedAs: "Empezó como",
    page: (n, of) => `Página ${n} de ${of}`,
    sheetPage: (n, of) => `Hoja, página ${n} de ${of}`,
    unitsUsed: (u) => `Unidades: ${u.join(", ")}`,
    copyName: (d) => `Mi versión del ${d}`,
    copyNameAt: (d, t) => `Mi versión del ${d}, ${t}`,
    copyFile: (d, t) => `Versión ${d} ${t.replace(/:/g, "-")}`,
    asOfLevel: (n) => `estado en el nivel ${n}`,
    createdOn: (d) => `Creado el ${d}`,
    cards: "Cartas",
    printHint: "Imprime a tamaño real (100 %). Recorta por las líneas.",
    atTheTable: "En la mesa",
    rulesText: "Texto de la regla",
    continued: "Continuación",
    continuesOnNextCard: "sigue en la carta siguiente",
    yes: "sí",
    no: "no",
    count: (n, name) => `${n} × ${name}`,
    sheet: "Hoja",
    rulesTexts: "Textos de reglas",
    rulesTextsTitle: "Textos de reglas para consultar",
    noRulesTexts: "Este personaje no tiene nada con un texto de regla.",
    fromExtensions: (names) => `Contiene contenido de ${names}.`,
    nothingToChoose: "Nada que elegir: ninguna opción encaja con este personaje.",
    fromLevelsAs: (tracks) => `De tus niveles de ${tracks}.`,
  },
};

export const PRINT_LANGUAGES = Object.keys(MESSAGES);
