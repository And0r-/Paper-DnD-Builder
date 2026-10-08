-- Login without password mails (AND-235).
--
-- An account now has a name its owner picks (not unique, shown to the
-- game master instead of the mail address) and may have a mail address,
-- kept only as a way back in. The server still makes every password; it
-- shows it once on the screen instead of mailing it. An account may have
-- several, each with a name its owner chooses ("phone", "on paper").
--
-- Accounts made before get the part of their address before the "@" as
-- their name; they may change it in the settings.
ALTER TABLE accounts ADD COLUMN name text;
UPDATE accounts SET name = left(split_part(email, '@', 1), 80);
ALTER TABLE accounts ALTER COLUMN name SET NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT accounts_name_length CHECK (char_length(name) BETWEEN 1 AND 80);

-- The address is no key anymore: two accounts may name the same one, and
-- a mail sent to it for a way back in then names both. Still normalised
-- (trimmed, lowercase) by the server.
ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE accounts DROP CONSTRAINT accounts_email_key;
CREATE INDEX accounts_email ON accounts (email) WHERE email IS NOT NULL;

-- The old single Argon2id password, for accounts made before only. Their
-- owner logs in once with address and password and gets a password of
-- the new kind; the column is then set to NULL. Drop the column once no
-- account has one left.
ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE passwords (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- SHA-256 (hex) of the normalised password. A login names no account, so
  -- the password is found by its hash; it is long and random enough that
  -- no salt or slow hash is needed (see auth/password.ts).
  hash text NOT NULL UNIQUE,
  -- What its owner called it; display only.
  name text NOT NULL CONSTRAINT passwords_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL
);

CREATE INDEX passwords_account_id ON passwords (account_id, created_at);
