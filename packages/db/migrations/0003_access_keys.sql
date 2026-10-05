-- Access keys: a person lets a tool (a script, later a language model)
-- work on their account over the HTTP API, without a browser.
--
-- Like sessions, only the SHA-256 of a key is stored; the key itself is
-- shown once when it is made. No "last used", no addresses: we keep
-- nothing about how a key is used. Deleting the account removes its keys.

CREATE TABLE access_keys (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- SHA-256 (hex) of the whole key.
  key_hash text NOT NULL UNIQUE,
  -- The first characters of the key, so its owner can tell keys apart in the list.
  hint text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX access_keys_account_id ON access_keys (account_id, created_at);
