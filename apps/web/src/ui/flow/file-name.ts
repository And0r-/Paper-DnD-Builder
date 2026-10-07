/**
 * The name a downloaded PDF is saved under: the one the server gives in
 * `filename*` (RFC 6266, UTF-8, percent-encoded), else the fallback. The
 * PDF is fetched and saved from a blob, so the browser never reads the
 * header itself; the `download` attribute carries the name.
 *
 * A name with letters beyond ASCII ("Ausführlich", "Jörg") is right here.
 * Chromium on Linux started without a UTF-8 locale (LANG unset or POSIX,
 * as in some containers) cannot write such a name to disk and saves
 * "download" instead, from a blob and from the header alike; that is the
 * browser's setting, not the name.
 */
export function fileNameOf(header: string | null, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;\s]+)/i.exec(header ?? "")?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}
