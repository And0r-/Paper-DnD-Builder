/**
 * The public MCP download `GET /downloads/builder-mcp.zip`: `server.mjs`
 * (bundled from packages/mcp when the web app is built), `config.json` with
 * this builder's address and no key, a Claude Desktop entry and both guides.
 * The same for everyone, nothing personal in it, so it needs no login. Made
 * once when the server starts and then only served.
 */
import { ZIP_GUIDES, zipTextFiles, type ZipGuide } from "@builder/mcp/download";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorResponse, HttpError } from "./api/http.ts";
import type { Config } from "./config.ts";

export const MCP_ZIP_NAME = "builder-mcp.zip";

/**
 * packages/mcp, found from the working directory like the migrations: the
 * repository root (tests) or apps/web (next dev / next start, and the
 * standalone server in the image, which runs from web/apps/web).
 */
export function mcpDir(): string | undefined {
  const candidates = [join(process.cwd(), "packages/mcp"), join(process.cwd(), "../../packages/mcp")];
  return candidates.find((dir) => existsSync(join(dir, "dist/server.mjs")));
}

export interface McpZip {
  body: Uint8Array<ArrayBuffer>;
  etag: string;
}

/** Why there is no zip: no `BASE_URL` to put in it, or no `server.mjs` in this build. */
export type McpZipState = McpZip | { missing: "baseUrlNotSet" | "mcpPackageMissing" };

export async function buildMcpZip(baseUrl: string, dir = mcpDir()): Promise<McpZipState> {
  if (!dir) return { missing: "mcpPackageMissing" };
  const [server, ...guides] = await Promise.all([
    readFile(join(dir, "dist/server.mjs")),
    ...Object.values(ZIP_GUIDES).map((path) => readFile(join(dir, path), "utf8")),
  ]);
  const texts = zipTextFiles(
    baseUrl,
    Object.fromEntries(Object.keys(ZIP_GUIDES).map((name, i) => [name, guides[i]!])) as Record<
      ZipGuide,
      string
    >,
  );
  const encode = (t: string) => new TextEncoder().encode(t);
  // zipSync allocates a fresh ArrayBuffer for its output.
  const body = zipSync({
    "server.mjs": new Uint8Array(server),
    ...Object.fromEntries(Object.entries(texts).map(([name, text]) => [name, encode(text)])),
  }) as Uint8Array<ArrayBuffer>;
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 32)}"`;
  return { body, etag };
}

// One zip per server process; kept on globalThis so dev hot reloads reuse it.
const holder = globalThis as unknown as { __builderMcpZip?: Promise<McpZipState> };

/**
 * The zip of this process, made on the first call (at start, see
 * instrumentation.ts). The address is the configured `BASE_URL`, never a
 * request's `Host` header: a forged Host must not become the address the
 * program sends its key to.
 */
export function mcpZip(config: Config): Promise<McpZipState> {
  holder.__builderMcpZip ??= config.baseUrl
    ? buildMcpZip(config.baseUrl.origin).catch((error: unknown): McpZipState => {
        console.error("MCP zip:", (error as Error).message);
        return { missing: "mcpPackageMissing" };
      })
    : Promise.resolve({ missing: "baseUrlNotSet" });
  return holder.__builderMcpZip;
}

export function mcpZipResponse(req: Request, zip: McpZipState): Response {
  if ("missing" in zip) {
    return errorResponse(
      zip.missing === "baseUrlNotSet"
        ? new HttpError(503, "baseUrlNotSet")
        : new HttpError(503, "mcpPackageMissing"),
    );
  }
  // Changes only with a new build or a new address; a cache asks again each time.
  const headers = { etag: zip.etag, "cache-control": "no-cache" };
  if (req.headers.get("if-none-match") === zip.etag) return new Response(null, { status: 304, headers });
  return new Response(zip.body, {
    status: 200,
    headers: {
      ...headers,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${MCP_ZIP_NAME}"`,
      "content-length": String(zip.body.byteLength),
    },
  });
}
