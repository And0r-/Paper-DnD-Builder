/**
 * The name of a kept copy of the sheet: "Meine Fassung vom 7. Oktober,
 * 14:20". Made when shown, in the screen's language, never stored, so a
 * copy reads right after a change of language. The year only when it is
 * not this year's. The PDF names it the same (`copyWhen`).
 *
 * In a list of copies (`copyChoice`) the level it was made at follows, as
 * in the sheet's footer: after a level, the old copy is the one with the
 * old level. Copies are listed newest first, everywhere (`newestFirst`).
 */
import { copyWhen } from "@builder/sheet";
import type { Translator } from "../../i18n/index.ts";

export function copyName(t: Translator["t"], lang: string, copy: { createdAt: string }): string {
  return t("sheet.copyName", { ...copyWhen(lang, new Date(copy.createdAt)) });
}

/** "Meine Fassung vom 7. Oktober, 14:20 · Stufe 3", the level's word from the package. */
export function copyChoice(
  t: Translator["t"],
  lang: string,
  levelName: string,
  copy: { createdAt: string; fromLevel: number },
): string {
  return t("sheet.copyChoice", { name: copyName(t, lang, copy), levelName, level: copy.fromLevel });
}

/** Newest first: the copy made last is the one most likely wanted. */
export function newestFirst<C extends { createdAt: string }>(copies: readonly C[]): C[] {
  return [...copies].reverse().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
