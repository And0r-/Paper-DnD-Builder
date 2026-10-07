/**
 * The MCP server over HTTP for many people: each request carries its own
 * access key as `Authorization: Bearer cbk_...` and gets the tools with that
 * key, nothing else. Stateless ("Streamable HTTP" without sessions): no
 * session id, answers as plain JSON, no open event stream, so it works
 * behind any proxy. Nothing is kept between requests but the package texts.
 *
 * `createHttpHandler` takes a web `Request` and returns a `Response`, so the
 * same code serves `node server.mjs` without a key (see `node-http.ts`) and
 * the web app's own route `/mcp`.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiClient, ApiError, PackageCache } from "./api-client.ts";
import { createMcpServer } from "./server.ts";
import { TOOLS, type Tool } from "./tools/index.ts";

export interface HttpHandlerOptions {
  /** Where the tools reach the builder's API; inside the web app, its internal address. */
  apiBaseUrl: string;
  /** The builder's address for people, named in the 401 answer. Defaults to `apiBaseUrl`. */
  publicUrl?: string;
  /**
   * Origins a browser may call from (`https://example.org`). A request with
   * any other `Origin` is refused (DNS rebinding); one without `Origin`
   * (an MCP program, curl) is let through.
   */
  allowedOrigins?: readonly string[];
  fetch?: typeof fetch;
  /** Package texts shared by all requests; one for this handler if absent. */
  packages?: PackageCache;
  tools?: readonly Tool[];
}

export type HttpHandler = (req: Request) => Promise<Response>;

const BEARER = /^Bearer\s+(cbk_[A-Za-z0-9_-]+)\s*$/i;

export function createHttpHandler(options: HttpHandlerOptions): HttpHandler {
  const packages = options.packages ?? new PackageCache();
  const tools = options.tools ?? TOOLS;
  const publicUrl = (options.publicUrl ?? options.apiBaseUrl).replace(/\/+$/, "");
  const allowed = new Set((options.allowedOrigins ?? []).map(originOf).filter((o) => o !== undefined));

  return async (req) => {
    const origin = req.headers.get("origin");
    if (origin !== null && !allowed.has(originOf(origin) ?? "")) {
      return rpcError(403, "This origin may not call the MCP server.");
    }
    if (req.method !== "POST") {
      return rpcError(405, "The MCP server takes POST only (Streamable HTTP without sessions).", {
        allow: "POST",
      });
    }

    const key = BEARER.exec(req.headers.get("authorization") ?? "")?.[1];
    if (!key) {
      return unauthorized(
        `No access key. Send one as "Authorization: Bearer cbk_...". ` +
          `Make a key when logged in on ${publicUrl} under Settings, Access keys.`,
        false,
      );
    }
    const client = new ApiClient({
      baseUrl: options.apiBaseUrl,
      key,
      packages,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    // Checks the key before anything else; the tools reuse the loaded account.
    try {
      await client.account();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        return unauthorized(
          `The access key is not valid: withdrawn, ended or mistyped. ` +
            `Make a new one when logged in on ${publicUrl} under Settings, Access keys.`,
          true,
        );
      }
      if (e instanceof ApiError && e.status === 429) {
        return rpcError(429, "Too many requests in a short time. Wait a minute and try again.");
      }
      return rpcError(502, "The MCP server could not reach the character builder. Try again later.");
    }

    const server = createMcpServer(client, tools);
    // No session id generator: stateless, a fresh transport per request.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };
}

function originOf(value: string): string | undefined {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

function unauthorized(message: string, keyGiven: boolean): Response {
  const challenge = keyGiven
    ? 'Bearer realm="character-builder", error="invalid_token"'
    : 'Bearer realm="character-builder"';
  return rpcError(401, message, { "www-authenticate": challenge });
}

/** An error the way the MCP library answers one: JSON-RPC with no id. */
function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
