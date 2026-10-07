/**
 * The MCP server: registers the shared tool list, nothing else. The
 * transport (stdio for a program on the player's computer) is attached by
 * the caller.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "./api-client.ts";
import { INTRO, TOOLS, type Tool, type ToolResult } from "./tools/index.ts";

export const SERVER_NAME = "character-builder";
export const SERVER_VERSION = "0.1.0";

export function createMcpServer(client: ApiClient, tools: readonly Tool[] = TOOLS): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INTRO });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
      async (input) => toCallToolResult(await tool.run(client, input)),
    );
  }
  return server;
}

/** A tool's data as JSON text for the model; a file goes along as an embedded resource. */
export function toCallToolResult(result: ToolResult): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(result.data, null, 2) }];
  if (result.file) {
    content.push({
      type: "resource",
      resource: {
        uri: `file:///${encodeURIComponent(result.file.name)}`,
        mimeType: result.file.mimeType,
        blob: result.file.data,
      },
    });
  }
  return { content, ...(result.isError ? { isError: true } : {}) };
}
