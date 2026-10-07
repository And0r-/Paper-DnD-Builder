/** The text files of the public zip: no key, both guides, placeholders the guides name. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { ZIP_ENTRY_NAME, ZIP_GUIDES, zipTextFiles, type ZipGuide } from "./download.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const guides = Object.fromEntries(
  Object.entries(ZIP_GUIDES).map(([name, path]) => [name, readFileSync(`${ROOT}${path}`, "utf8")]),
) as Record<ZipGuide, string>;

describe("zipTextFiles", () => {
  const files = zipTextFiles("https://builder.example", guides);

  it("holds config.json with the address and an empty key: public until a key is entered", () => {
    expect(Object.keys(files).sort()).toEqual([
      "ANLEITUNG.md",
      "README.md",
      "claude_desktop_config.json",
      "config.json",
    ]);
    expect(JSON.parse(files["config.json"]!)).toEqual({ baseUrl: "https://builder.example", key: "" });
    expect(JSON.stringify(files)).not.toMatch(/cbk_[A-Za-z0-9]/);
  });

  it("gives Claude Desktop an entry with PATH and KEY to replace; KEY left in place is refused", () => {
    expect(JSON.parse(files["claude_desktop_config.json"]!)).toEqual({
      mcpServers: {
        [ZIP_ENTRY_NAME]: { command: "node", args: ["PATH/server.mjs"], env: { BUILDER_KEY: "KEY" } },
      },
    });
    expect(() =>
      loadConfig(ROOT, { BUILDER_BASE_URL: "https://builder.example", BUILDER_KEY: "KEY" }),
    ).toThrow(/must start with cbk_/);
  });

  it("fills the address into both guides, which name both modes and the privacy box", () => {
    for (const [name, heading, privacy] of [
      ["README.md", /^# Character builder with a language model/, "**Privacy**"],
      ["ANLEITUNG.md", /^# Charakterbuilder mit einem Sprachmodell/, "**Datenschutz**"],
    ] as const) {
      const guide = files[name]!;
      expect(guide).toMatch(heading);
      expect(guide).toContain(privacy);
      expect(guide).toContain("**https://builder.example**");
      expect(guide).toContain("`private, stdio`");
      expect(guide).toContain("`public, HTTP on port 8787`");
      expect(guide).toContain(ZIP_ENTRY_NAME);
      expect(guide).not.toContain("{{");
    }
  });
});
