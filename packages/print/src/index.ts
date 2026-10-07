/**
 * Print: the character sheet (A4), the cards and the rules texts as one PDF,
 * made on the server from a sheet model (`@builder/sheet`). The package decides what
 * goes where (sheet.json); this module owns the visual design and knows
 * nothing about any game.
 */
export { renderPdf, type DrawnField, type RenderedPdf, type RenderOptions } from "./render.ts";
export { sheetPlaces, type SheetPlaces } from "./places.ts";
