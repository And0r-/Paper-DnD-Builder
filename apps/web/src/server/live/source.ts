/**
 * Where a change comes from, as the live channel shows it: the browser,
 * a program with a key, or an MCP program; whose account, in which role,
 * and from which browser window.
 */
import type { ChangeSource, Via } from "../app.ts";
import type { RequestContext, Session } from "../api/router.ts";
import type { ReachableDraftRow } from "../store.ts";

/**
 * A program says what it is: `X-Builder-Client: mcp` from the MCP server
 * (in the web app and in the zip). A label for the screen, not a proof;
 * whoever has the key could send anything here, and only gets their own
 * change labelled otherwise.
 */
export const CLIENT_HEADER = "x-builder-client";
/** A browser window's own id on its changes, so it knows them when they come back. */
export const CLIENT_ID_HEADER = "x-builder-client-id";
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function viaOf(session: Pick<Session, "via">, headers: Headers): Via {
  if (session.via === "cookie") return "browser";
  return headers.get(CLIENT_HEADER)?.trim().toLowerCase() === "mcp" ? "mcp" : "api";
}

/** A window id as given, or null for none or one that is not a short plain token. */
export function clientIdOf(value: string | null | undefined): string | null {
  return typeof value === "string" && CLIENT_ID.test(value) ? value : null;
}

/** The source of a change made by this HTTP request, on a draft the viewer reaches as `role`. */
export async function requestSource(
  ctx: RequestContext,
  role: ReachableDraftRow["access"],
): Promise<ChangeSource> {
  const session = await ctx.requireSession();
  return {
    via: viaOf(session, ctx.req.headers),
    accountId: session.account.id,
    accountName: session.account.name,
    role,
    clientId: clientIdOf(ctx.req.headers.get(CLIENT_ID_HEADER)),
  };
}
