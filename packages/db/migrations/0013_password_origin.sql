-- Passwords without a name of their own (AND-240).
--
-- A password the server names itself used to get the day ("2026-10-08")
-- or "Reset" and the day, in no language. The screen now names it in the
-- player's language instead: "First password", "New from email link", or
-- "Password from 8 October" for one made in the settings without a name.
-- So the server stores no name for those (NULL), and where the password
-- came from, if that is how the screen names it.
ALTER TABLE passwords ALTER COLUMN name DROP NOT NULL;
ALTER TABLE passwords ADD COLUMN origin text CONSTRAINT passwords_origin CHECK (origin IN ('first', 'reset'));

-- Passwords made before: the names the server gave them are recognised by
-- their form. A player could have typed such a name; it then reads as the
-- same day in their language, which is what it said.
UPDATE passwords SET origin = 'reset', name = NULL WHERE name ~ '^Reset \d{4}-\d{2}-\d{2}$';
UPDATE passwords SET origin = 'first'
  WHERE name ~ '^\d{4}-\d{2}-\d{2}$'
    AND id IN (SELECT DISTINCT ON (account_id) id FROM passwords ORDER BY account_id, created_at, id);
UPDATE passwords SET name = NULL WHERE name ~ '^\d{4}-\d{2}-\d{2}$';
