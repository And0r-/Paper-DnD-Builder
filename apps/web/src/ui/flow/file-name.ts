/**
 * The name a downloaded PDF is saved under: the one the server gives in
 * `filename*` (RFC 6266, UTF-8, percent-encoded), else the fallback, made
 * portable. The PDF is fetched and saved from a blob, so the browser never
 * reads the header itself; the `download` attribute carries the name.
 *
 * Portable means ASCII. Chromium on Linux started without a UTF-8 locale
 * (LANG unset or POSIX, as in some containers and test machines) cannot
 * write a name with a letter beyond ASCII ("Détaillée", "Ausführlich",
 * "Gaëlle") and saves "download" instead, without ".pdf": from a blob and
 * from the header alike. Nothing in the page can tell. A file that cannot be
 * found again is worse than a name without its accents, so the accents go:
 * "Mathis - Detaillee - Fiche.pdf".
 */
export function fileNameOf(header: string | null, fallback: string, lang = "en"): string {
  const encoded = /filename\*=UTF-8''([^;\s]+)/i.exec(header ?? "")?.[1];
  let name = fallback;
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {
      // A broken header: the fallback.
    }
  }
  return portableFileName(name, lang) ?? portableFileName(fallback, lang) ?? "character.pdf";
}

/** Letters NFKD does not take apart, and German's own way of writing its umlauts without them. */
const LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  þ: "th",
  Þ: "TH",
};
const GERMAN: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue" };
const MARKS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "“": "'",
  "”": "'",
  "„": "'",
  "«": "'",
  "»": "'",
  "–": "-",
  "—": "-",
  "…": "...",
};

/**
 * "Gaëlle Sœur-d’Épée - Détaillée - Fiche.pdf" → "Gaelle Soeur-d'Epee - Detaillee - Fiche.pdf".
 * Characters a file system refuses (\ / : * ? " < > |) become "-". A part
 * with nothing left (a name in Greek or Japanese) is dropped; with nothing
 * left at all there is no portable name.
 */
export function portableFileName(name: string, lang: string): string | undefined {
  const stem = name.replace(/\.pdf$/i, "");
  const parts = stem
    .split(" - ")
    .map((part) =>
      [...part]
        .map((c) => (lang === "de" ? GERMAN[c] : undefined) ?? LETTERS[c] ?? MARKS[c] ?? c)
        .join("")
        .normalize("NFKD")
        .replace(/[^\x20-\x7e]/g, "")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => /[A-Za-z0-9]/.test(part));
  return parts.length === 0 ? undefined : `${parts.join(" - ")}.pdf`;
}
