/**
 * Print: the character sheet (A4) and the cards as one PDF, made on the
 * server. The package decides what goes where (sheet.json); this module
 * owns the visual design and knows nothing about any game.
 */
export { cardCount, isCard } from "./cards.ts";
export { MESSAGES, PRINT_LANGUAGES, type Messages } from "./messages.ts";
export {
  buildPrintModel,
  printLanguages,
  PrintError,
  type Card,
  type PrintModel,
  type PrintSettings,
  type SheetSection,
  type Uses,
} from "./model.ts";
export { renderPdf, type RenderedPdf } from "./render.ts";
