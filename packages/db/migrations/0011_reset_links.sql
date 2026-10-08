-- A way back in for whoever lost every password (AND-236).
--
-- An account with a mail address can ask for a link to it. The link holds
-- a random 256-bit token; like a session, only its SHA-256 is stored, so a
-- leaked database holds no usable link. It works once, for 30 minutes,
-- and then shows a new password on the screen. The mail itself holds no
-- password.
--
-- Nothing else is kept: no address (it is on the account), no "used at"
-- (a used link is deleted). Expired rows are deleted on occasion.
CREATE TABLE reset_links (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX reset_links_account_id ON reset_links (account_id);
CREATE INDEX reset_links_expires_at ON reset_links (expires_at);
