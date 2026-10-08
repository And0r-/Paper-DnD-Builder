/**
 * The language a package is shown in when a reader wants one: that one if
 * the package has it, else English, else the package's first. English is
 * the fallback because it is the language most packages have and most
 * readers can make something of; the screen says so in a sentence.
 */
export const FALLBACK_LANGUAGE = "en";

export function shownLanguage(languages: readonly string[], wanted: string | null | undefined): string {
  if (wanted && languages.includes(wanted)) return wanted;
  return languages.includes(FALLBACK_LANGUAGE) ? FALLBACK_LANGUAGE : languages[0]!;
}
