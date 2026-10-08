import { api, type Campaign } from "./api.ts";

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
