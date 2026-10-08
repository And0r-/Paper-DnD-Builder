/**
 * Campaigns. Whoever makes one leads it (the game master) and invites
 * players with one link per campaign, sent by the game master however they
 * like or shown as a QR code; whoever opens it and joins is a player. The
 * builder sends no invitation mails. The game master sees the players'
 * names, never their addresses. The game master reaches the players' characters that
 * belong to the campaign (open, change, print, make a new one for a
 * player); the characters stay the players'. A character in no campaign,
 * or in another one, stays private. A player sees the campaigns they are in and who leads
 * them, nothing of the other players. Anyone else sees nothing: a campaign
 * they are not in answers 404, exactly like a missing one.
 *
 * Every check is here, on the server, on every request; the screens only
 * show what these routes allow.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { limited, nameSchema } from "../../auth/accounts.ts";
import { LIMITS } from "../../auth/rate-limit.ts";
import { sessionId } from "../../auth/session.ts";
import type { AccountRow, CampaignRow, PlayerRow } from "../../store.ts";
import { clientIp, HttpError, json, readJson } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";
import { createDraft, listEntry } from "./drafts.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Enough for anyone who leads groups; stops a loop from filling the table. */
export const MAX_CAMPAIGNS_PER_ACCOUNT = 50;
export const MAX_PLAYERS_PER_CAMPAIGN = 50;

/** 128 random bits, 22 characters: enough that nobody guesses one, short enough for a small QR code. */
const newInviteToken = () => randomBytes(16).toString("base64url");
const INVITE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
/** How the store keeps a replaced token: its SHA-256, like a session's. */
const oldInviteId = sessionId;

/**
 * The link the game master hands out. On BASE_URL when it is set, else on
 * the address the game master's own browser used: the link is only shown
 * to them, so a forged Host header fools nobody else.
 */
const inviteUrl = (ctx: RequestContext, token: string) =>
  new URL(`/join/${token}`, ctx.app.config.baseUrl ?? ctx.url.origin).href;

const publicCampaign = (c: CampaignRow) => ({
  id: c.id,
  name: c.name,
  role: c.leading ? "gameMaster" : "player",
  gameMaster: { name: c.game_master_name },
  playerCount: c.player_count,
  createdAt: c.created_at.toISOString(),
  /** When the viewer joined as a player; null for the game master. */
  joinedAt: c.joined_at?.toISOString() ?? null,
});

// A name only: the mail address of other people is never given out.
const publicPlayer = (p: PlayerRow) => ({ id: p.id, name: p.name, addedAt: p.added_at.toISOString() });

/** The campaign of the URL if the viewer leads it or plays in it; else 404. */
async function loadCampaign(ctx: RequestContext): Promise<{ campaign: CampaignRow; viewer: AccountRow }> {
  const { account } = await ctx.requireSession();
  const id = ctx.params["id"]!;
  const campaign = UUID.test(id) ? await ctx.app.store.findCampaign(id, account.id) : undefined;
  if (!campaign) throw new HttpError(404, "campaignNotFound");
  return { campaign, viewer: account };
}

/** As {@link loadCampaign}; a player of the campaign gets 403, as they know it exists. */
async function loadLedCampaign(ctx: RequestContext) {
  const found = await loadCampaign(ctx);
  if (!found.campaign.leading) throw new HttpError(403, "gameMasterOnly");
  return found;
}

/** The player of the URL in a campaign the viewer leads. */
async function loadPlayer(ctx: RequestContext) {
  const { campaign } = await loadLedCampaign(ctx);
  const id = ctx.params["playerId"]!;
  const player = UUID.test(id) ? await ctx.app.store.findPlayer(campaign.id, id) : undefined;
  if (!player) throw new HttpError(404, "playerNotFound");
  return { campaign, player };
}

/**
 * The invitation of the URL. Every lookup counts against the IP, found or
 * not: 128 bits cannot be guessed, and the limit keeps a guessing loop from
 * costing the server anything.
 */
/**
 * The campaign a link opens. With `viewer`, a replaced link is looked up
 * too (`old`); the caller answers it only to a member.
 */
async function loadInvite(ctx: RequestContext, viewer?: AccountRow) {
  limited(ctx.app, `invite-open:ip:${clientIp(ctx.req)}`, LIMITS.inviteOpensPerIp, true);
  const token = ctx.params["token"]!;
  if (INVITE_TOKEN.test(token)) {
    const invite = await ctx.app.store.findInvite(token);
    if (invite) return { ...invite, old: false };
    const old = viewer && (await ctx.app.store.findOldInvite(oldInviteId(token)));
    if (old) return { ...old, old: true };
  }
  throw new HttpError(404, "inviteNotFound");
}

export const campaignRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/campaigns",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const rows = await ctx.app.store.listCampaigns(account.id);
      return json(200, { campaigns: rows.map(publicCampaign) });
    },
  },
  {
    method: "POST",
    path: "/api/campaigns",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const body = await readJson(ctx.req, z.strictObject({ name: nameSchema }));
      const id = randomUUID();
      const made = await ctx.app.store.createCampaign(
        {
          id,
          account_id: account.id,
          name: body.name,
          invite_token: newInviteToken(),
          created_at: ctx.app.now(),
        },
        MAX_CAMPAIGNS_PER_ACCOUNT,
      );
      if (!made) throw new HttpError(422, "tooManyCampaigns", { max: MAX_CAMPAIGNS_PER_ACCOUNT });
      const campaign = (await ctx.app.store.findCampaign(id, account.id))!;
      return json(201, {
        campaign: { ...publicCampaign(campaign), inviteUrl: inviteUrl(ctx, campaign.invite_token!) },
        characters: [],
        players: [],
      });
    },
  },
  {
    // The game master gets the invitation link, their own characters in this campaign and the
    // players with theirs; a player gets `characters: null, players: null`.
    method: "GET",
    path: "/api/campaigns/:id",
    handler: async (ctx) => {
      const { campaign, viewer } = await loadCampaign(ctx);
      if (!campaign.leading) {
        return json(200, { campaign: publicCampaign(campaign), characters: null, players: null });
      }
      const [players, drafts, token] = await Promise.all([
        ctx.app.store.listPlayers(campaign.id),
        ctx.app.store.listCampaignDrafts(campaign.id),
        campaign.invite_token ?? ctx.app.store.ensureInviteToken(campaign.id, viewer.id, newInviteToken()),
      ]);
      return json(200, {
        // The invitation link only for the game master: they decide who gets it.
        campaign: { ...publicCampaign(campaign), inviteUrl: inviteUrl(ctx, token) },
        characters: drafts.filter((d) => d.account_id === viewer.id).map((d) => listEntry(ctx.app, d)),
        players: players.map((p) => ({
          ...publicPlayer(p),
          characters: drafts.filter((d) => d.account_id === p.id).map((d) => listEntry(ctx.app, d)),
        })),
      });
    },
  },
  {
    method: "PATCH",
    path: "/api/campaigns/:id",
    handler: async (ctx) => {
      const { campaign, viewer } = await loadLedCampaign(ctx);
      const body = await readJson(ctx.req, z.strictObject({ name: nameSchema }));
      await ctx.app.store.renameCampaign(campaign.id, viewer.id, body.name);
      return json(200, { campaign: publicCampaign({ ...campaign, name: body.name }) });
    },
  },
  {
    // The campaign and its player list go; every character stays with its player.
    method: "DELETE",
    path: "/api/campaigns/:id",
    handler: async (ctx) => {
      const { campaign, viewer } = await loadLedCampaign(ctx);
      await ctx.app.store.deleteCampaign(campaign.id, viewer.id);
      // The game master no longer reaches the players' characters: their live channel ends.
      await ctx.app.live.recheck((c) => c.role === "gameMaster");
      return json(204, null);
    },
  },
  {
    // A new invitation link; the old one stops working, the players stay.
    method: "POST",
    path: "/api/campaigns/:id/invite",
    handler: async (ctx) => {
      const { campaign, viewer } = await loadLedCampaign(ctx);
      limited(ctx.app, `invite:account:${viewer.id}`, LIMITS.invitationsPerAccount, true);
      const token = newInviteToken();
      await ctx.app.store.replaceInviteToken(campaign.id, viewer.id, token, ctx.app.now());
      return json(200, { inviteUrl: inviteUrl(ctx, token) });
    },
  },
  {
    // The game master removes a player; a player leaves with `me` as the id.
    // The player's characters stay theirs and leave the campaign; the game master no longer reaches them.
    method: "DELETE",
    path: "/api/campaigns/:id/players/:playerId",
    handler: async (ctx) => {
      const { campaign, viewer } = await loadCampaign(ctx);
      const playerId = ctx.params["playerId"]!;
      if (!campaign.leading) {
        if (playerId !== "me" && playerId !== viewer.id) throw new HttpError(403, "gameMasterOnly");
        await ctx.app.store.removePlayer(campaign.id, viewer.id);
        await ctx.app.live.recheck((c) => c.role === "gameMaster");
        return json(204, null);
      }
      const removed = UUID.test(playerId) && (await ctx.app.store.removePlayer(campaign.id, playerId));
      if (!removed) throw new HttpError(404, "playerNotFound");
      // The game master's live channel to the player's characters ends with the access.
      await ctx.app.live.recheck((c) => c.role === "gameMaster");
      return json(204, null);
    },
  },
  {
    // A new character for a player; it is the player's, the game master builds it.
    method: "POST",
    path: "/api/campaigns/:id/players/:playerId/drafts",
    handler: async (ctx) => {
      const { campaign, player } = await loadPlayer(ctx);
      return createDraft(ctx, player, "gameMaster", campaign.id);
    },
  },
  {
    // Who invites to what: shown before joining, also to whoever has no account yet.
    // Logged in, also whether one leads the campaign or plays in it already;
    // a member learns that from a replaced link too, nobody else does.
    method: "GET",
    path: "/api/invites/:token",
    handler: async (ctx) => {
      const session = await ctx.session();
      const invite = await loadInvite(ctx, session?.account);
      const viewer = session?.account.id;
      const you =
        viewer === undefined
          ? null
          : invite.game_master_id === viewer
            ? "gameMaster"
            : (await ctx.app.store.isMember(invite.campaign_id, viewer))
              ? "player"
              : null;
      if (invite.old && !you) throw new HttpError(404, "inviteNotFound");
      return json(200, {
        campaign: { id: invite.campaign_id, name: invite.campaign_name },
        gameMaster: { name: invite.game_master_name },
        you,
      });
    },
  },
  {
    // Joins the campaign as a player. Joining again, or as its game master, changes nothing.
    method: "POST",
    path: "/api/invites/:token/join",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const invite = await loadInvite(ctx);
      if (invite.game_master_id !== account.id) {
        const added = await ctx.app.store.addPlayer(
          invite.campaign_id,
          account.id,
          ctx.app.now(),
          MAX_PLAYERS_PER_CAMPAIGN,
        );
        if (!added) throw new HttpError(422, "tooManyPlayers", { max: MAX_PLAYERS_PER_CAMPAIGN });
      }
      return json(200, { campaignId: invite.campaign_id });
    },
  },
];
