-- Access keys get a name its owner chooses ("the laptop at home"), so the
-- list says what each key is for. Display only; never used to find a key.
--
-- Keys made before have no name. They get the day they were made, as text
-- (2026-10-04): a word such as "Key" would be in one language only.
ALTER TABLE access_keys ADD COLUMN name text;
UPDATE access_keys SET name = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD');
ALTER TABLE access_keys ALTER COLUMN name SET NOT NULL;
ALTER TABLE access_keys ADD CONSTRAINT access_keys_name_length CHECK (char_length(name) BETWEEN 1 AND 80);

-- Room for keys a later assistant in the web screens makes for itself:
-- such a key ends on its own (`expires_at`) and is told apart by `kind`.
-- Nothing sets either yet: every key is `personal` and lasts until withdrawn.
-- A key past its `expires_at` is refused like a withdrawn one.
ALTER TABLE access_keys ADD COLUMN expires_at timestamptz;
ALTER TABLE access_keys ADD COLUMN kind text NOT NULL DEFAULT 'personal'
  CONSTRAINT access_keys_kind CHECK (kind IN ('personal', 'assistant'));
