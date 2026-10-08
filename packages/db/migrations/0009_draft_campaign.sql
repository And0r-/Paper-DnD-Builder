-- A character may belong to one campaign of its owner, or to none
-- (AND-231). The player picks it when making the character and may change
-- it later; a game master who builds for a player sets their campaign.
--
-- Deleting the campaign leaves the character with its owner, in no
-- campaign. Nothing else is stored.
ALTER TABLE drafts ADD COLUMN campaign_id uuid REFERENCES campaigns (id) ON DELETE SET NULL;

CREATE INDEX drafts_campaign_id ON drafts (campaign_id) WHERE campaign_id IS NOT NULL;
