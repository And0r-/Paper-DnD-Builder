import { api, type Campaign } from "./api.ts";

/** The value of "no campaign" in a list of campaigns. */
export const NO_CAMPAIGN = "";

/**
 * The campaigns a character of the viewer may belong to: those they play
 * in, the one they joined last first. That one is the usual choice: a
 * player is invited, logs in and makes the character for it.
 */
export async function loadPlayedCampaigns(): Promise<Campaign[]> {
  const { campaigns } = await api<{ campaigns: Campaign[] }>("GET", "/api/campaigns");
  return campaigns
    .filter((c) => c.role === "player")
    .sort((a, b) => (b.joinedAt ?? "").localeCompare(a.joinedAt ?? "") || a.name.localeCompare(b.name));
}
