-- Help links for the live help (AND-244).
--
-- The owner of a character asks someone for help while building it: they
-- make a link and hand it over (or show it as a QR code). A logged-in
-- account that opens it joins the draft live and may answer its choices,
-- like the game master of the draft's campaign may without a link.
--
-- One link per draft; making a new one replaces it, deleting it stops it.
-- It ends on its own after `expires_at`. The token is a random 128-bit
-- value stored as it is, like an invitation token: the owner must see the
-- link again while someone helps (a new one would lock the helper out),
-- and it opens one draft for a few hours, not an account. Gone with the
-- draft.
CREATE TABLE help_links (
  token text PRIMARY KEY,
  draft_id uuid NOT NULL UNIQUE REFERENCES drafts (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX help_links_expires_at ON help_links (expires_at);
