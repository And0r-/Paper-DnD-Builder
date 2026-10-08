/**
 * Help links: the owner of a character asks someone for help. They make a
 * link for one draft and hand it over; a logged-in account that opens it
 * reaches that draft, live (see live/hub.ts) and over the draft routes
 * that open and change it (`?help=<token>`), until the link ends: after
 * HELP_LINK_HOURS, when the owner makes a new one, or withdraws it. The
 * helper never reaches anything else of the owner's: not the list, not
 * the prints, not the kept sheets, and cannot delete the character.
 *
 * The game master of the draft's campaign needs no link: they reach it
 * already. Everyone else gets 404 for a draft without a working link.
 */
import { randomBytes } from "node:crypto";
import { limited } from "../../auth/accounts.ts";
import { LIMITS } from "../../auth/rate-limit.ts";
import type { HelpLinkRow } from "../../store.ts";
import { clientIp, HttpError, json } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";
import { HELP_TOKEN, loadDraft } from "./drafts.ts";

/** Long enough to build a character together in one evening. */
export const HELP_LINK_HOURS = 12;

/** 128 random bits, 22 characters: like an invitation, short enough for a small QR code. */
const newHelpToken = () => randomBytes(16).toString("base64url");

/** The path the live channel of a draft answers on (see live/upgrade.ts). */
export const livePath = (draftId: string, token?: string) =>
  `/api/live/drafts/${draftId}${token ? `?help=${token}` : ""}`;

/** As the owner sees it: the link to hand over (on BASE_URL when set, like an invitation). */
const publicHelpLink = (ctx: RequestContext, link: HelpLinkRow) => ({
  url: new URL(`/help/${link.token}`, ctx.app.config.baseUrl ?? ctx.url.origin).href,
  token: link.token,
  expiresAt: link.expires_at.toISOString(),
  createdAt: link.created_at.toISOString(),
});

/** The draft of the URL, for its owner only; a game master gets 403, anyone else 404. */
async function loadOwnDraft(ctx: RequestContext) {
  const found = await loadDraft(ctx);
  if (found.row.access !== "owner") throw new HttpError(403, "ownerOnly");
  return found;
}

export const helpLinkRoutes: Route[] = [
  {
    // The draft's working help link, to show it again; null for none.
    method: "GET",
    path: "/api/drafts/:id/help-link",
    handler: async (ctx) => {
      const { row } = await loadOwnDraft(ctx);
      const link = await ctx.app.store.findHelpLink(row.id, ctx.app.now());
      return json(200, { helpLink: link ? publicHelpLink(ctx, link) : null });
    },
  },
  {
    // A new help link; the one before stops working.
    method: "POST",
    path: "/api/drafts/:id/help-link",
    handler: async (ctx) => {
      const { row, viewer } = await loadOwnDraft(ctx);
      limited(ctx.app, `help-link:account:${viewer.id}`, LIMITS.helpLinksPerAccount, true);
      const now = ctx.app.now();
      const expires = new Date(now.getTime() + HELP_LINK_HOURS * 60 * 60 * 1000);
      const link = await ctx.app.store.replaceHelpLink(row.id, viewer.id, newHelpToken(), expires, now);
      if (!link) throw new HttpError(404, "draftNotFound");
      // Whoever helped with the old link is out, also live.
      ctx.app.draftEvents.publish({ kind: "access", draftId: row.id });
      return json(201, { helpLink: publicHelpLink(ctx, link) });
    },
  },
  {
    // Withdraws the help link: whoever helps with it is out at once, also live.
    method: "DELETE",
    path: "/api/drafts/:id/help-link",
    handler: async (ctx) => {
      const { row } = await loadOwnDraft(ctx);
      await ctx.app.store.deleteHelpLink(row.id);
      ctx.app.draftEvents.publish({ kind: "access", draftId: row.id });
      return json(204, null);
    },
  },
  {
    // What a help link opens: shown before helping, also to whoever is not logged in yet.
    // Every lookup counts against the IP, found or not, like an invitation's.
    method: "GET",
    path: "/api/help/:token",
    handler: async (ctx) => {
      limited(ctx.app, `help-open:ip:${clientIp(ctx.req)}`, LIMITS.inviteOpensPerIp, true);
      const token = ctx.params["token"]!;
      const help = HELP_TOKEN.test(token) ? await ctx.app.store.findHelp(token, ctx.app.now()) : undefined;
      if (!help) throw new HttpError(404, "helpLinkNotFound");
      const session = await ctx.session();
      return json(200, {
        draftId: help.draft_id,
        owner: { name: help.owner_name },
        expiresAt: help.expires_at.toISOString(),
        /** True when the viewer owns the draft: they need no help link for it. */
        yours: session?.account.id === help.owner_id,
        live: livePath(help.draft_id, token),
      });
    },
  },
];
