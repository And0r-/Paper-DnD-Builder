-- Campaigns: a group of players and the person who leads it.
--
-- Whoever makes a campaign leads it (the game master); there is no role
-- on the account. A player is an account the game master added. The game
-- master may open, change and print every character of the campaign's
-- players; the characters stay with the players (drafts.account_id).
--
-- What is stored: the campaign's name, who leads it, who plays in it and
-- since when. Deleting the game master's account removes the campaign and
-- every assignment; deleting a player's account removes their assignments
-- (and their characters, by the cascade on drafts). Nothing else is kept.

CREATE TABLE campaigns (
  id uuid PRIMARY KEY,
  -- The game master.
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX campaigns_account_id ON campaigns (account_id, created_at);

CREATE TABLE campaign_players (
  campaign_id uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL,
  PRIMARY KEY (campaign_id, account_id)
);

-- "Which campaigns is this account in", and the access check on drafts.
CREATE INDEX campaign_players_account_id ON campaign_players (account_id);
