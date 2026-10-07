-- Which version of a character's sheet an account opened last: the
-- original (copy_id null) or one of its kept copies. The online sheet
-- opens there next time. Set when someone picks a version and when the
-- first change to the original makes a copy.
--
-- Per account, because a game master and the player look at the same
-- character. A setting like the units: no history, deleted with the
-- account or the character; a deleted copy falls back to the original.

CREATE TABLE sheet_views (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES drafts (id) ON DELETE CASCADE,
  copy_id uuid REFERENCES sheet_copies (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, draft_id)
);
