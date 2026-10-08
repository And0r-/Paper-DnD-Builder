/**
 * Campaigns. Whoever makes one leads it (the game master) and adds players
 * by mail address (until invitations by link come); the game master sees
 * the players' names, never their addresses. The game master reaches the players' characters that
 * belong to the campaign (open, change, print, make a new one for a
 * player); the characters stay the players'. A character in no campaign,
 * or in another one, stays private. A player sees the campaigns they are in and who leads
 * them, nothing of the other players. Anyone else sees nothing: a campaign
 * they are not in answers 404, exactly like a missing one.
 *
 * Every check is here, on the server, on every request; the screens only
 * show what these routes allow.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emailSchema, inviteAccount, limited, nameSchema, UI_LANGUAGES } from "../../auth/accounts.ts";
import { LIMITS } from "../../auth/rate-limit.ts";
import type { AccountRow, CampaignRow, PlayerRow } from "../../store.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";
import { createDraft, listEntry } from "./drafts.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Enough for anyone who leads groups; stops a loop from filling the table. */
export const MAX_CAMPAIGNS_PER_ACCOUNT = 50;
export const MAX_PLAYERS_PER_CAMPAIGN = 50;

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
        { id, account_id: account.id, name: body.name, created_at: ctx.app.now() },
        MAX_CAMPAIGNS_PER_ACCOUNT,
      );
      if (!made) throw new HttpError(422, "tooManyCampaigns", { max: MAX_CAMPAIGNS_PER_ACCOUNT });
      const campaign = (await ctx.app.store.findCampaign(id, account.id))!;
      return json(201, { campaign: publicCampaign(campaign), characters: [], players: [] });
    },
  },
  {
    // The game master gets their own characters in this campaign and the
    // players with theirs; a player gets `characters: null, players: null`.
    method: "GET",
    path: "/api/campaigns/:id",
    handler: async (ctx) => {
      const { campaign, viewer } = await loadCampaign(ctx);
      if (!campaign.leading) {
        return json(200, { campaign: publicCampaign(campaign), characters: null, players: null });
      }
      const [players, drafts] = await Promise.all([
        ctx.app.store.listPlayers(campaign.id),
        ctx.app.store.listCampaignDrafts(campaign.id),
      ]);
      return json(200, {
        campaign: publicCampaign(campaign),
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
      return json(204, null);
    },
  },
  {
    // Add a player by mail address. An existing account gets a short mail that
    // names the game master; an address without an account gets an account
    // without a password (see inviteAccount). The answer is the same either way.
    method: "POST",
    path: "/api/campaigns/:id/players",
    handler: async (ctx) => {
      const { campaign, viewer } = await loadLedCampaign(ctx);
      const body = await readJson(
        ctx.req,
        z.strictObject({
          email: emailSchema,
          /** Language of the new account and its mail; an existing account keeps its own. */
          language: z.enum(UI_LANGUAGES).optional(),
        }),
      );
      const existing = (await ctx.app.store.findAccountsByEmail(body.email))[0];
      if (existing?.id === viewer.id) throw new HttpError(422, "cannotAddYourself");
      if (existing && (await ctx.app.store.findPlayer(campaign.id, existing.id))) {
        throw new HttpError(409, "alreadyPlayer");
      }
      if (campaign.player_count >= MAX_PLAYERS_PER_CAMPAIGN) {
        throw new HttpError(422, "tooManyPlayers", { max: MAX_PLAYERS_PER_CAMPAIGN });
      }
      limited(ctx.app, `invite:account:${viewer.id}`, LIMITS.invitationsPerAccount, true);
      const account = await inviteAccount(
        ctx.app,
        body.email,
        body.language ?? viewer.language,
        { by: viewer.name, campaign: campaign.name },
        async (a) => {
          const added = await ctx.app.store.addPlayer(
            campaign.id,
            a.id,
            ctx.app.now(),
            MAX_PLAYERS_PER_CAMPAIGN,
          );
          if (!added) throw new HttpError(422, "tooManyPlayers", { max: MAX_PLAYERS_PER_CAMPAIGN });
        },
      );
      const player = (await ctx.app.store.findPlayer(campaign.id, account.id))!;
      return json(201, { player: publicPlayer(player) });
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
        return json(204, null);
      }
      const removed = UUID.test(playerId) && (await ctx.app.store.removePlayer(campaign.id, playerId));
      if (!removed) throw new HttpError(404, "playerNotFound");
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
];
