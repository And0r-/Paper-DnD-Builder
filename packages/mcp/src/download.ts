/**
 * The text files of the download zip, from the guide template and the
 * account's address and key. Pure: the web route reads the template and the
 * bundled `server.mjs` from disk and zips what this returns.
 */

export type GuideLanguage = "de" | "en";

/** The entry name in the MCP program's config; matches the guide of that language. */
export const ENTRY_NAME: Record<GuideLanguage, string> = {
  de: "charakterbuilder",
  en: "character-builder",
};

/** Stands for the folder the player unpacks to; the guide says to replace it. */
export const SERVER_PATH: Record<GuideLanguage, string> = {
  de: "PFAD/server.mjs",
  en: "PATH/server.mjs",
};

export interface PackageInput {
  language: GuideLanguage;
  /** The builder's public address, from the server configuration. */
  baseUrl: string;
  /** The new key and its name in the account's list; absent when the zip holds none. */
  key?: { secret: string; name: string };
}

/**
 * Fills a guide template: `{{BASE_URL}}`, `{{KEY_NAME}}`, and the sections
 * `{{#KEY}}...{{/KEY}}` (only with a key) and `{{^KEY}}...{{/KEY}}` (only
 * without). A section whose opening tag ends its line takes the line break
 * after its closing tag with it, so block sections leave no empty lines.
 */
export function renderGuide(template: string, input: PackageInput): string {
  const sections = template.replace(
    /\{\{([#^])KEY\}\}(\n?)([\s\S]*?)\{\{\/KEY\}\}(\n?)/g,
    (_all, kind: string, open: string, body: string, close: string) => {
      const show = (kind === "#") === (input.key !== undefined);
      if (!show) return open ? "" : close;
      return body + (open ? "" : close);
    },
  );
  return sections.replaceAll("{{BASE_URL}}", input.baseUrl).replaceAll("{{KEY_NAME}}", input.key?.name ?? "");
}

/** `config.json` next to `server.mjs`, as `loadConfig` reads it. `key` is empty without a key. */
export function configFile(input: PackageInput): string {
  return JSON.stringify({ baseUrl: input.baseUrl, key: input.key?.secret ?? "" }, null, 2) + "\n";
}

/** A ready `claude_desktop_config.json` with the path placeholder the guide names. */
export function desktopConfigFile(language: GuideLanguage): string {
  const entry = { command: "node", args: [SERVER_PATH[language]] };
  return JSON.stringify({ mcpServers: { [ENTRY_NAME[language]]: entry } }, null, 2) + "\n";
}

// --- the public zip (round 2): the same for everyone, no key ------------------------------------

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
