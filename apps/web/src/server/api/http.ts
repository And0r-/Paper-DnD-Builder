/**
 * Small HTTP helpers on the standard Request/Response types.
 *
 * Errors are JSON: `{ "error": { "code": "...", ...details } }`. Codes are
 * stable, English and machine-readable; the screen turns them into words in
 * the player's language.
 */
import type { ZodType } from "zod";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    details: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  // Personal data: never cache, not in the browser and not in a proxy.
  h.set("Cache-Control", "no-store");
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: h });
}

export function errorResponse(e: HttpError): Response {
  return json(e.status, { error: { code: e.code, ...e.details } }, e.headers);
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Reads a JSON body and checks its shape. Only `application/json` is accepted (a CSRF guard, too).
 * `maxBytes` raises the 64 KiB limit for the few routes that take a whole document.
 */
export async function readJson<T>(req: Request, schema: ZodType<T>, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, "jsonRequired");
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new HttpError(413, "bodyTooLarge", { max: maxBytes });
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, "bodyTooLarge", { max: maxBytes });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "badJson");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "badRequest", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

/**
 * Client address for per-IP limits: the last X-Forwarded-For entry. Next.js
 * fills that header from the socket when no proxy set it; behind a reverse
 * proxy the last entry is the address the proxy saw.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last && last.length <= 64 ? last : "unknown";
}

/**
 * Rejects state-changing requests from other sites. Together with
 * SameSite=Lax cookies and the JSON-only bodies this closes CSRF.
 */
export function assertSameOrigin(req: Request, expected: string): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "crossSite");
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== expected) throw new HttpError(403, "crossSite");
}
