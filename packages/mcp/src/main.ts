/**
 * Entry point of `server.mjs` (`node server.mjs`), in one of two modes:
 *
 * - private, with a key in `config.json` or `BUILDER_KEY`: over stdio, as
 *   Claude Desktop, Claude Code, Cursor and other MCP programs start it.
 *   stdout carries the protocol; messages for people go to stderr.
 * - public, without a key: over HTTP at `/mcp` on `PORT` (8787), each
 *   request with its own `Authorization: Bearer cbk_...`.
 *
 * Either way it talks to one builder and to nothing else. One line on
 * stderr says which mode runs.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createHttpHandler } from "./http.ts";
import { createNodeServer } from "./node-http.ts";
import { createMcpServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig(dirname(fileURLToPath(import.meta.url)), process.env);
  if (config.mode === "private") {
    const server = createMcpServer(new ApiClient(config));
    await server.connect(new StdioServerTransport());
    console.error("private, stdio");
    return;
  }
  const http = createNodeServer(
    createHttpHandler({ apiBaseUrl: config.baseUrl, allowedOrigins: config.allowedOrigins }),
  );
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(config.port, resolve);
  });
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.error(`public, HTTP on port ${port}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
});
