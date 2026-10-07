/**
 * The name of a kept copy of the sheet: "Meine Fassung vom 7. Oktober,
 * 14:20". Made when shown, in the screen's language, never stored, so a
 * copy reads right after a change of language. The year only when it is
 * not this year's.
 */
import type { Translator } from "../../i18n/index.ts";

export function copyName(t: Translator["t"], lang: string, copy: { createdAt: string }): string {
  const at = new Date(copy.createdAt);
  const sameYear = at.getFullYear() === new Date().getFullYear();
  const date = new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(at);
  return t("sheet.copyName", { date, time });
}
