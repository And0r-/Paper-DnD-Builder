/**
 * The MCP download: `server.mjs` (bundled from packages/mcp when the web app
 * is built), `config.json`, a `claude_desktop_config.json` entry and the
 * guide in the account's language, zipped in memory per request.
 */
import { configFile, desktopConfigFile, renderGuide, type PackageInput } from "@builder/mcp/download";
import { zipSync } from "fflate";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * packages/mcp, found from the working directory like the migrations: the
 * repository root (tests) or apps/web (next dev / next start, and the
 * standalone server in the image, which runs from web/apps/web).
 */
export function mcpDir(): string | undefined {
  const candidates = [join(process.cwd(), "packages/mcp"), join(process.cwd(), "../../packages/mcp")];
  return candidates.find((dir) => existsSync(join(dir, "dist/server.mjs")));
}

interface McpSources {
  server: Uint8Array;
  guides: Record<PackageInput["language"], string>;
}

// Read once per process: the files change only with a new build.
let sources: Promise<McpSources | undefined> | undefined;

async function readSources(): Promise<McpSources | undefined> {
  const dir = mcpDir();
  if (!dir) return undefined;
  const [server, de, en] = await Promise.all([
    readFile(join(dir, "dist/server.mjs")),
    readFile(join(dir, "templates/README.de.md"), "utf8"),
    readFile(join(dir, "templates/README.en.md"), "utf8"),
  ]);
  return { server: new Uint8Array(server), guides: { de, en } };
}

/** The zip, or undefined when this build has no `server.mjs` (the web app was not built with it). */
export async function mcpPackageZip(input: PackageInput): Promise<Uint8Array<ArrayBuffer> | undefined> {
  sources ??= readSources().then((s) => {
    if (!s) sources = undefined;
    return s;
  });
  const s = await sources;
  if (!s) return undefined;
  const text = (t: string) => new TextEncoder().encode(t);
  // zipSync allocates a fresh ArrayBuffer for its output.
  return zipSync({
    "server.mjs": s.server,
    "config.json": text(configFile(input)),
    "claude_desktop_config.json": text(desktopConfigFile(input.language)),
    "README.md": text(renderGuide(s.guides[input.language], input)),
  }) as Uint8Array<ArrayBuffer>;
}
