/**
 * The public MCP server at `/mcp`, inside the web app: the shared tools of
 * @builder/mcp over stateless HTTP, one `Authorization: Bearer cbk_...` key
 * per request (see `createHttpHandler`).
 *
 * The tools reach the API in process: their requests go straight into the
 * same API handler the /api route uses, never through a socket. So nothing
 * leaves the server, no internal address needs configuring, and the tools
 * can do exactly what a program with that key can do over the API, nothing
 * more. They never touch the database themselves.
 */
import { createHttpHandler, PackageCache } from "@builder/mcp";
import type { App } from "./app.ts";
import { clientIp } from "./api/http.ts";
import { LIMITS } from "./auth/rate-limit.ts";

/** The page for people; the address `/mcp` itself is the server. */
export const MCP_SETUP_PATH = "/mcp/setup";

/** Tool calls are small; a body above this is refused before anything reads it. */
const MAX_BODY = 1024 * 1024;

export function createMcpRoute(
  app: App,
  api: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  const publicUrl = app.config.baseUrl?.origin;
  const handler = createHttpHandler({
    // Only names the API in the tools' request URLs; the fetch below never leaves the process.
    apiBaseUrl: publicUrl ?? "http://localhost",
    ...(publicUrl ? { publicUrl, allowedOrigins: [publicUrl] } : {}),
    fetch: (input, init) => api(new Request(input, init)),
    // Package texts loaded once per package and language, shared by every key.
    packages: new PackageCache(),
  });

  return async (req) => {
    // Someone opened the address in a browser: show them the page about it.
    // MCP programs send POST and never see this.
    if (req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html")) {
      return new Response(null, { status: 303, headers: { location: MCP_SETUP_PATH } });
    }
    const limit = app.limiter.take(`mcp:ip:${clientIp(req)}`, LIMITS.mcpRequestsPerIp);
    if (!limit.ok) {
      return rpcError(429, "Too many requests in a short time. Wait a minute and try again.", {
        "retry-after": String(limit.retryAfter),
      });
    }
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) {
      return rpcError(413, "The request is too large.");
    }
    return handler(req);
  };
}

/** An error the way `createHttpHandler` answers one: JSON-RPC with no id. */
function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
