-- Extensions switched on for a character (AND-260).
--
-- An extension package adds to the draft's base package (SPEC 17). Each
-- character decides for itself which extensions it uses; none by default,
-- so every existing character stays exactly what it was. Stored as the
-- extensions' package ids; a character whose extension is not loaded is
-- kept and shown again once it is, like one whose base package is missing.
ALTER TABLE drafts ADD COLUMN extensions text[] NOT NULL DEFAULT '{}';
