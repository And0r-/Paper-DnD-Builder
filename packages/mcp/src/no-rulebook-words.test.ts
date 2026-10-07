/**
 * The builder knows no game (AND-1, principle 6): no word of a rulebook in
 * this package, not in code, descriptions, templates or tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rulebookHits, TERMS } from "./rulebook-terms.ts";

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
      for (const hit of rulebookHits(readFileSync(file, "utf8")))
        hits.push(`${file.slice(ROOT.length)}: ${hit}`);
    }
    expect(hits).toEqual([]);
  });
});
