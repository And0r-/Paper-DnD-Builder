-- Accounts, sessions and character drafts.
--
-- This is everything the builder stores about a person: a mail address,
-- a password hash, settings, and their characters. No names, no IP
-- addresses, no activity log. Deleting an account removes all of it
-- (ON DELETE CASCADE).

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  -- Normalised (trimmed, lowercase). The only key a person has.
  email text NOT NULL UNIQUE,
  -- Argon2id PHC string; the password itself is never stored.
  password_hash text NOT NULL,
  -- Language of screen texts and mails, e.g. "de".
  language text NOT NULL,
  -- Chosen unit per dimension, e.g. {"length": "ft"}. Missing dimensions follow the language.
  units jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  -- SHA-256 of the session token; the token itself lives only in the browser cookie.
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  refreshed_at timestamptz NOT NULL
);

CREATE INDEX sessions_account_id ON sessions (account_id);

-- A character draft is one document. `version` grows with every change;
-- a change names the version it was made on (optimistic locking), so two
-- people editing the same draft never silently overwrite each other.
CREATE TABLE drafts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  -- Package version the draft was last changed with; for information only.
  package_version text NOT NULL,
  version integer NOT NULL,
  -- {"level": n, "answers": {choiceKey: answer}}; everything else is derived.
  document jsonb NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX drafts_account_id ON drafts (account_id, updated_at DESC);
