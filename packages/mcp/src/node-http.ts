/**
 * Serves an `HttpHandler` on Node's own HTTP server at `/mcp`: no framework,
 * so `server.mjs` stays one file. Request bodies are capped; nothing about a
 * request (least of all its key) is logged.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { HttpHandler } from "./http.ts";

export const MCP_PATH = "/mcp";
/** Larger than any tool call; a bigger body is refused before it is read in full. */
const MAX_BODY = 1024 * 1024;

export function createNodeServer(handler: HttpHandler): Server {
  return createServer((req, res) => {
    serve(handler, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("Internal error\n");
    });
  });
}

async function serve(handler: HttpHandler, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // A fixed base: the Host header is the caller's to choose and says nothing here.
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== MCP_PATH) {
    res
      .writeHead(404, { "content-type": "text/plain" })
      .end(`Not found. The MCP server is at ${MCP_PATH}.\n`);
    return;
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  if (body === null) {
    res.writeHead(413, { "content-type": "text/plain", connection: "close" }).end("Request too large\n");
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const answer = await handler(
    new Request(url, { method: req.method ?? "GET", headers, ...(body ? { body } : {}) }),
  );
  const out: Record<string, string> = {};
  answer.headers.forEach((value, name) => (out[name] = value));
  res.writeHead(answer.status, out);
  res.end(Buffer.from(await answer.arrayBuffer()));
}

/** The whole body, or null when it is larger than `MAX_BODY`. */
async function readBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
