/**
 * The MCP zip for everyone, without a login: `curl -O <address>/downloads/builder-mcp.zip`.
 * Made once at start; see src/server/mcp-zip.ts.
 */
import { readConfig } from "../../../src/server/config.ts";
import { mcpZip, mcpZipResponse } from "../../../src/server/mcp-zip.ts";

export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  return mcpZipResponse(req, await mcpZip(readConfig()));
}

export { handle as GET, handle as HEAD };
