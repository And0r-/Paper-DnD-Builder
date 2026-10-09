import type { Translator } from "../i18n/index.ts";
import { api, type Campaign, type DraftInfo } from "./api.ts";
import { CAMPAIGN_KEY, type LeadStep } from "./flow/model.ts";

/** The value of "no campaign" in a list of campaigns. */
export const NO_CAMPAIGN = "";

/**
 * The campaigns a character of the viewer may belong to: those they play in
 * and those they lead, the one they joined last first (for one they lead,
 * making it counts as joining). That one is the usual choice: a player is
 * invited, logs in and makes the character for it.
 */
export async function loadMemberCampaigns(): Promise<Campaign[]> {
  const { campaigns } = await api<{ campaigns: Campaign[] }>("GET", "/api/campaigns");
  const joined = (c: Campaign) => c.joinedAt ?? c.createdAt;
  return campaigns.sort((a, b) => joined(b).localeCompare(joined(a)) || a.name.localeCompare(b.name));
}

/**
 * The step "Campaign" before the game's steps (AND-333), for whoever is in
 * a campaign: the owner who plays in or leads one (to change it), and a game
 * master building for a player (to look at). Nobody else sees it, and a
 * character of someone in no campaign has none.
 */
export function campaignLeads(
  t: Translator["t"],
  draft: Pick<DraftInfo, "access" | "campaignId">,
  /** Whether the viewer plays in or leads any campaign. */
  inCampaigns: boolean,
): LeadStep[] {
  const shown =
    draft.access === "gameMaster" || (draft.access === "owner" && (inCampaigns || draft.campaignId !== null));
  return shown ? [{ key: CAMPAIGN_KEY, title: t("new.campaignLabel") }] : [];
}
