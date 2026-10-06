-- Copies of the character sheet and the play state, both kept apart from
-- the draft document. The builder never reads either: what a player
-- writes into a copy or ticks at the table cannot change the character
-- or its checks.
--
-- A copy is a sheet model (as @builder/sheet makes it) a player keeps and
-- changes freely, like a printed page. It stays exactly as it was when the
-- character changes later (level, answers, package update, language). It
-- remembers the original it was made from (level, when the character last
-- changed, package version), so the screen can say "the original changed
-- since" without comparing models.
--
-- The play state is what is written and rubbed out during play (field id
-- of the sheet to a number, a text or a count of ticks). One per
-- character; it applies to the original and every copy alike.
--
-- Deleting the character deletes both.

CREATE TABLE sheet_copies (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES drafts (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  -- The original it was made from.
  from_level integer NOT NULL,
  from_changed_at timestamptz NOT NULL,
  from_package_version text NOT NULL,
  -- Language and units the copy is written in; they never change with the account's.
  language text NOT NULL,
  units jsonb NOT NULL,
  model jsonb NOT NULL,
  version integer NOT NULL
);

CREATE INDEX sheet_copies_draft_id ON sheet_copies (draft_id, created_at);

CREATE TABLE character_states (
  draft_id uuid PRIMARY KEY REFERENCES drafts (id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL
);
