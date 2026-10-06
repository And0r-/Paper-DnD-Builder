/**
 * Print: the character sheet (A4) and the cards as one PDF, made on the
 * server from a sheet model (`@builder/sheet`). The package decides what
 * goes where (sheet.json); this module owns the visual design and knows
 * nothing about any game.
 */
export { renderPdf, type RenderedPdf } from "./render.ts";
