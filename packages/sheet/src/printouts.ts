/**
 * What a printout can hold and how it looks: the parts of the PDF, the
 * sheet designs, and the choice an account keeps for its next download.
 * Plain data without pdfkit, so the screen offers exactly what the server
 * prints.
 */
import { z } from "zod";

/** The parts of a printout, in the order they follow each other in one file. */
export const PRINT_PARTS = ["sheet", "cards", "texts"] as const;
export type PrintPart = (typeof PRINT_PARTS)[number];

/**
 * What a PDF holds when nobody says: the sheet and the cards, as before the
 * parts existed, so existing callers of the API get the same file.
 */
export const DEFAULT_API_PARTS: readonly PrintPart[] = ["sheet", "cards"];

/** The parts in file order, each once. */
export function inFileOrder(parts: Iterable<PrintPart>): PrintPart[] {
  const wanted = new Set(parts);
  return PRINT_PARTS.filter((p) => wanted.has(p));
}

/** A sheet design: how the sheet looks. Cards and rules texts look the same in every design. */
export interface SheetDesign {
  id: string;
  /** Its name and one line about it, per screen language. */
  name: Readonly<Record<string, string>>;
  description: Readonly<Record<string, string>>;
}

/**
 * The designs the server can print, the first one being the default. A design
 * is a folder in `designs/` (geometry, screen, PDF painter) and an entry
 * here. A design id that is planned but not drawn yet goes into DESIGN_IDS
 * only: the API knows it and says so instead of "unknown".
 */
export const SHEET_DESIGNS: readonly SheetDesign[] = [
  {
    id: "verbose",
    name: { de: "Ausführlich", en: "Detailed" },
    description: {
      de: "Mit Hinweisen und Erklärungen in einfachen Worten. Gut für den Anfang.",
      en: "With hints and explanations in plain words. Good to start with.",
    },
  },
  {
    id: "classic",
    name: { de: "Klassisch", en: "Classic" },
    description: {
      de: "Alles am gewohnten Platz, wenig Text. Für alle, die das Spiel kennen.",
      en: "Everything in its usual place, little text. For those who know the game.",
    },
  },
];

/** Every design id the API accepts, drawn or still to come. */
export const DESIGN_IDS = ["classic", "verbose"] as const;

/** Whether the sheet comes empty, to write on, or with the play state filled in. */
export const PRINT_STATES = ["empty", "filled"] as const;

/** What an account picked for its last download; the dialog starts from it next time. */
export const printChoiceSchema = z.strictObject({
  parts: z
    .array(z.enum(PRINT_PARTS))
    .min(1)
    .max(PRINT_PARTS.length)
    .refine((p) => new Set(p).size === p.length, "each part once"),
  design: z.enum(DESIGN_IDS),
  state: z.enum(PRINT_STATES),
});
export type PrintChoice = z.infer<typeof printChoiceSchema>;

/**
 * For an account that never downloaded: the sheet and the cards, in the
 * first design, with the play state filled in. Only what the dialog starts
 * from; the PDF without `parts` or `state` stays the sheet and the cards, empty.
 */
export const DEFAULT_PRINT_CHOICE: PrintChoice = {
  parts: ["sheet", "cards"],
  design: SHEET_DESIGNS[0]!.id as PrintChoice["design"],
  state: "filled",
};

/** A stored choice as far as it is still valid; the rest from the default. */
export function printChoiceOf(stored: unknown): PrintChoice {
  const raw = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  const field = <K extends keyof PrintChoice>(key: K): PrintChoice[K] => {
    const parsed = printChoiceSchema.shape[key].safeParse(raw[key]);
    return parsed.success ? (parsed.data as PrintChoice[K]) : DEFAULT_PRINT_CHOICE[key];
  };
  const design = field("design");
  return {
    parts: inFileOrder(field("parts")),
    // A design that is no longer offered falls back to the default.
    design: SHEET_DESIGNS.some((d) => d.id === design) ? design : DEFAULT_PRINT_CHOICE.design,
    state: field("state"),
  };
}
