/**
 * Entry point of `server.mjs`: the MCP server over stdio, as Claude
 * Desktop, Claude Code, Cursor and other MCP programs start it
 * (`node server.mjs`). It talks to one builder with one access key and to
 * nothing else. stdout carries the protocol; messages for people go to
 * stderr.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createMcpServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig(dirname(fileURLToPath(import.meta.url)), process.env);
  const server = createMcpServer(new ApiClient(config));
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
});
