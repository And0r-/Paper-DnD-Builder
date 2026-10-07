/**
 * The public MCP server: POST with `Authorization: Bearer cbk_...`, the shared
 * tools of @builder/mcp over the API in process. A browser opening the address
 * goes to the page /mcp/setup. See src/server/mcp-route.ts.
 */
import { createApiHandler } from "../../src/server/api/router.ts";
import { getApp } from "../../src/server/app.ts";
import { createMcpRoute } from "../../src/server/mcp-route.ts";

export const dynamic = "force-dynamic";

let handler: Promise<(req: Request) => Promise<Response>> | undefined;

async function handle(req: Request): Promise<Response> {
  handler ??= getApp().then((app) => createMcpRoute(app, createApiHandler(app)));
  return (await handler)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
