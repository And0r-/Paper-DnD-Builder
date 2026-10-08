/** The part of fontkit the tests use, to ask a font file which characters it can draw. */
declare module "fontkit" {
  export function openSync(path: string): { hasGlyphForCodePoint(codePoint: number): boolean };
}
