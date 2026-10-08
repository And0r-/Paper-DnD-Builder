-- Invitation links that were replaced (AND-241).
--
-- A new link stops the old one: nobody joins with it. A player who is
-- already in the campaign and opens the old link once more should still
-- learn that, instead of "this invitation no longer exists". So the old
-- token is kept, as its SHA-256 only: it opens nothing anymore, it only
-- tells a member which campaign it was. Gone with the campaign.
CREATE TABLE campaign_old_invites (
  token_hash text PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  replaced_at timestamptz NOT NULL
);

CREATE INDEX campaign_old_invites_campaign_id ON campaign_old_invites (campaign_id);
