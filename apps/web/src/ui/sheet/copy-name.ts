/**
 * The name of a kept copy of the sheet: "Meine Fassung vom 7. Oktober,
 * 14:20". Made when shown, in the screen's language, never stored, so a
 * copy reads right after a change of language. The year only when it is
 * not this year's. The PDF names it the same (`copyWhen`).
 */
import { copyWhen } from "@builder/sheet";
import type { Translator } from "../../i18n/index.ts";

export function copyName(t: Translator["t"], lang: string, copy: { createdAt: string }): string {
  return t("sheet.copyName", { ...copyWhen(lang, new Date(copy.createdAt)) });
}
