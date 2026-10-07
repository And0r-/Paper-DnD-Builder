/**
 * The stdio server as an MCP program starts it: a child process spoken to
 * over stdin and stdout. Its tools are exactly the shared list.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";
import { SERVER_NAME, toCallToolResult } from "./server.ts";
import { TOOLS } from "./tools/index.ts";
import { TOOL_DESCRIPTIONS } from "./tools/descriptions.ts";

const STDIO = fileURLToPath(new URL("./stdio.ts", import.meta.url));

describe("the stdio server", () => {
  it("registers exactly the shared tool list", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO],
      // Nothing listens there: listing tools needs no builder.
      env: { BUILDER_BASE_URL: "http://127.0.0.1:9", BUILDER_KEY: "cbk_test" },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
      expect(tools.map((t) => t.description)).toEqual(TOOLS.map((t) => t.description));

      // A tool runs and answers with words, not a crash, when the builder cannot be reached.
      const res = await client.callTool({ name: "list_characters", arguments: {} });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/Could not reach the character builder/);
    } finally {
      await client.close();
    }
  });

  it("has the 13 tools of the first round, each described", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(TOOL_DESCRIPTIONS).sort());
    expect(TOOLS).toHaveLength(13);
    for (const t of TOOLS) expect(t.description).toBe(TOOL_DESCRIPTIONS[t.name]);
  });

  it("hands a file over as an embedded resource next to the JSON text", () => {
    const result = toCallToolResult({
      data: { file: "Mira.pdf" },
      file: { name: "Mira.pdf", mimeType: "application/pdf", data: "JVBERi0=" },
    });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ file: "Mira.pdf" }, null, 2) },
      {
        type: "resource",
        resource: { uri: "file:///Mira.pdf", mimeType: "application/pdf", blob: "JVBERi0=" },
      },
    ]);
    expect(result.isError).toBeUndefined();
  });
});

describe("configuration", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "builder-mcp-"));

  it("reads config.json next to the server", () => {
    const d = dir();
    writeFileSync(join(d, "config.json"), JSON.stringify({ baseUrl: "https://b.example", key: "cbk_file" }));
    expect(loadConfig(d, {})).toEqual({ baseUrl: "https://b.example", key: "cbk_file" });
  });

  it("lets BUILDER_BASE_URL and BUILDER_KEY override the file", () => {
    const d = dir();
    writeFileSync(join(d, "config.json"), JSON.stringify({ baseUrl: "https://b.example", key: "cbk_file" }));
    expect(loadConfig(d, { BUILDER_KEY: "cbk_env" })).toEqual({
      baseUrl: "https://b.example",
      key: "cbk_env",
    });
    expect(loadConfig(d, { BUILDER_BASE_URL: "http://localhost:3000" }).baseUrl).toBe(
      "http://localhost:3000",
    );
  });

  it("says what is missing", () => {
    const d = dir();
    expect(() => loadConfig(d, {})).toThrow(ConfigError);
    expect(() => loadConfig(d, { BUILDER_BASE_URL: "https://b.example" })).toThrow(/No access key/);
    writeFileSync(join(d, "config.json"), "{ not json");
    expect(() => loadConfig(d, {})).toThrow(/not valid JSON/);
  });
});
