/**
 * The builder knows no game (AND-1, principle 6): no word of a rulebook in
 * this package, not in code, descriptions, templates or tests. The 75
 * terms of the phase 2 acceptance (AND-69) are searched as whole words,
 * ignoring case. They are stored encoded so this file does not hold them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TERMS = Buffer.from(
  "VGllZmxpbmcKRHJhZ29uYm9ybgpEcmFjaGVuYmzDvHRpZ2VyCkZldWVyYmFsbApGaXJlYmFsbApBY3Rpb24gU3VyZ2UKVGF0ZW5kcmFuZwpBa29seXRoCkFjb2x5dGUKU2FjcmVkIEZsYW1lCktldHRlbmhlbWQKQ2hhaW4gTWFpbApNYWdpYyBNaXNzaWxlCk1hZ2lzY2hlcyBHZXNjaG9zcwpLw6RtcGZlcgpGaWdodGVyCktsZXJpa2VyCkNsZXJpYwpTY2h1cmtlClJvZ3VlCk1hZ2llcgpXaXphcmQKUGFsYWRpbgpCYXJiYXIKQmFyYmFyaWFuCk3Dtm5jaApNb25rCldhbGRsw6R1ZmVyClJhbmdlcgpCYXJkZQpCYXJkCkRydWlkZQpEcnVpZApaYXViZXJlcgpTb3JjZXJlcgpIZXhlbm1laXN0ZXIKV2FybG9jawpTZWNvbmQgV2luZApEdXJjaHNjaG" +
    "5hdWZlbgpTbmVhayBBdHRhY2sKSGludGVyaMOkbHRpZ2VyIEFuZ3JpZmYKRGl2aW5lIE9yZGVyCkVwaWMgQm9vbgpFcGlzY2hlIEdhYmUKSGFsZmxpbmcKSGFsYmxpbmcKRWxmClp3ZXJnCkR3YXJmCkdub20KR25vbWUKT3JrCk9yYwpHb2xpYXRoCkFhc2ltYXIKQ2hhbXBpb24KU29sZGF0ClNvbGRpZXIKV2Vpc2VyClNhZ2UKTGFuZ3NjaHdlcnQKTG9uZ3N3b3JkCkN1cmUgV291bmRzCld1bmRlbiBoZWlsZW4KRWxkcml0Y2ggQmxhc3QKU2NoYXVlcmxpY2hlciBTdHJhaGwKV2lsZCBTaGFwZQpUaWVyZ2VzdGFsdApSYWdlCkthbXBmcmF1c2NoCktpCk1ldGFtYWdpZQpNZXRhbWFnaWMKTXlzdGlzY2hlcyBBcmthbnVtCk15c3RpYyBBcmNhbnVt",
  "base64",
)
  .toString("utf8")
  .split("\n");

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name === "dist") return [];
    const path = join(dir, e.name);
    return e.isDirectory() ? files(path) : [path];
  });
}

describe("packages/mcp", () => {
  it("holds none of the 75 rulebook terms", () => {
    expect(TERMS).toHaveLength(75);
    const hits: string[] = [];
    for (const file of files(ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const term of TERMS) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}_])${term.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_])`, "iu");
        if (re.test(text)) hits.push(`${file.slice(ROOT.length)}: ${term.length} letters, starts ${term[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
