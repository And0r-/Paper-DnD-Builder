/**
 * The packages folder of the browser tests with two games (project
 * "two-games" in playwright.config.ts): the demo package with its
 * extension, and a copy of it under another id without one, standing in
 * for another edition of a game. The copy has a name and short text of its
 * own, and its last step another title, so the step list shows which
 * package is in use. Run before its server starts; writes `e2e/.two-games/`.
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const TWO_GAMES = fileURLToPath(new URL("./.two-games/", import.meta.url));
const DEMO = fileURLToPath(new URL("../../../packages/demo-package/", import.meta.url));

/** The copy's own texts, by language. */
export const OTHER = {
  de: {
    "package.name": "Nebelland, erste Fassung",
    "package.short": "Die ältere Fassung der erfundenen Welt. Zum Ausprobieren des Wechsels.",
    "step.looks.title": "Gesicht",
  },
  en: {
    "package.name": "Mistland, first edition",
    "package.short": "The older version of the invented world. For trying out the switch.",
    "step.looks.title": "Face",
  },
} as const;

async function make(): Promise<void> {
  await rm(TWO_GAMES, { recursive: true, force: true });
  const skip = (src: string) => !src.includes("node_modules");
  await cp(DEMO, path.join(TWO_GAMES, "demo"), { recursive: true, filter: skip });
  const other = path.join(TWO_GAMES, "other");
  await cp(DEMO, other, {
    recursive: true,
    filter: (src) => skip(src) && !src.startsWith(path.join(DEMO, "extensions")),
  });
  const manifest = path.join(other, "manifest.json");
  const m = JSON.parse(await readFile(manifest, "utf8")) as Record<string, unknown>;
  await writeFile(manifest, JSON.stringify({ ...m, id: "other", version: "1.0.0" }));
  for (const [lang, entries] of Object.entries(OTHER)) {
    const file = path.join(other, "texts", lang, "core.json");
    const t = JSON.parse(await readFile(file, "utf8")) as { entries: Record<string, string> };
    await writeFile(file, JSON.stringify({ ...t, entries: { ...t.entries, ...entries } }));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await make();
