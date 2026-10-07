/**
 * The 75 rulebook terms of the phase 2 acceptance (AND-69), for tests that
 * check the builder knows no game (AND-1, principle 6). Stored encoded so
 * this file does not hold them. Matched as whole words, ignoring case.
 */
export const TERMS = Buffer.from(
  "VGllZmxpbmcKRHJhZ29uYm9ybgpEcmFjaGVuYmzDvHRpZ2VyCkZldWVyYmFsbApGaXJlYmFsbApBY3Rpb24gU3VyZ2UKVGF0ZW5kcmFuZwpBa29seXRoCkFjb2x5dGUKU2FjcmVkIEZsYW1lCktldHRlbmhlbWQKQ2hhaW4gTWFpbApNYWdpYyBNaXNzaWxlCk1hZ2lzY2hlcyBHZXNjaG9zcwpLw6RtcGZlcgpGaWdodGVyCktsZXJpa2VyCkNsZXJpYwpTY2h1cmtlClJvZ3VlCk1hZ2llcgpXaXphcmQKUGFsYWRpbgpCYXJiYXIKQmFyYmFyaWFuCk3Dtm5jaApNb25rCldhbGRsw6R1ZmVyClJhbmdlcgpCYXJkZQpCYXJkCkRydWlkZQpEcnVpZApaYXViZXJlcgpTb3JjZXJlcgpIZXhlbm1laXN0ZXIKV2FybG9jawpTZWNvbmQgV2luZApEdXJjaHNjaG" +
    "5hdWZlbgpTbmVhayBBdHRhY2sKSGludGVyaMOkbHRpZ2VyIEFuZ3JpZmYKRGl2aW5lIE9yZGVyCkVwaWMgQm9vbgpFcGlzY2hlIEdhYmUKSGFsZmxpbmcKSGFsYmxpbmcKRWxmClp3ZXJnCkR3YXJmCkdub20KR25vbWUKT3JrCk9yYwpHb2xpYXRoCkFhc2ltYXIKQ2hhbXBpb24KU29sZGF0ClNvbGRpZXIKV2Vpc2VyClNhZ2UKTGFuZ3NjaHdlcnQKTG9uZ3N3b3JkCkN1cmUgV291bmRzCld1bmRlbiBoZWlsZW4KRWxkcml0Y2ggQmxhc3QKU2NoYXVlcmxpY2hlciBTdHJhaGwKV2lsZCBTaGFwZQpUaWVyZ2VzdGFsdApSYWdlCkthbXBmcmF1c2NoCktpCk1ldGFtYWdpZQpNZXRhbWFnaWMKTXlzdGlzY2hlcyBBcmthbnVtCk15c3RpYyBBcmNhbnVt",
  "base64",
)
  .toString("utf8")
  .split("\n");

/** Which terms a text holds, each told by length and first letter only (the report must not hold them either). */
export function rulebookHits(text: string): string[] {
  return TERMS.filter((term) =>
    new RegExp(`(?<![\\p{L}\\p{N}_])${term.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_])`, "iu").test(text),
  ).map((term) => `${term.length} letters, starts ${term[0]}`);
}
