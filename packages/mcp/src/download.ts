/**
 * The text files of the public download zip, the same for everyone: no key,
 * nothing personal. Pure: the web app reads the guide templates and the
 * bundled `server.mjs` from disk once at start and zips what this returns.
 */

/** The guides of the public zip, one per language, both always in it (the link knows no one). */
export const ZIP_GUIDES = {
  "README.md": "templates/zip/README.md",
  "ANLEITUNG.md": "templates/zip/ANLEITUNG.md",
} as const;

export type ZipGuide = keyof typeof ZIP_GUIDES;

/** The entry in `claude_desktop_config.json`; both guides name it. */
export const ZIP_ENTRY_NAME = "character-builder";

/**
 * The text files of the public zip next to `server.mjs`: `config.json` with
 * the builder's address and an empty key, a `claude_desktop_config.json`
 * entry with `PATH` and `KEY` to replace, and both guides with the address
 * filled in. `guides` holds the templates as read from `ZIP_GUIDES`.
 */
export function zipTextFiles(baseUrl: string, guides: Record<ZipGuide, string>): Record<string, string> {
  const desktop = {
    mcpServers: {
      [ZIP_ENTRY_NAME]: { command: "node", args: ["PATH/server.mjs"], env: { BUILDER_KEY: "KEY" } },
    },
  };
  return {
    "config.json": JSON.stringify({ baseUrl, key: "" }, null, 2) + "\n",
    "claude_desktop_config.json": JSON.stringify(desktop, null, 2) + "\n",
    "README.md": guides["README.md"].replaceAll("{{BASE_URL}}", baseUrl),
    "ANLEITUNG.md": guides["ANLEITUNG.md"].replaceAll("{{BASE_URL}}", baseUrl),
  };
}
