-- A role per account, and a first admin (AND-353).
--
-- Whoever runs the builder needs to see and look after the accounts on it:
-- find one, end every login of a taken-over one, delete one. Nobody could
-- until now: every account was the same. An account is a player, or an
-- admin who may do that, in the browser only (never with an access key).
-- Every account from before is a player.
ALTER TABLE accounts ADD COLUMN role text NOT NULL DEFAULT 'player'
  CONSTRAINT accounts_role CHECK (role IN ('player', 'admin'));

-- Nobody can make themselves an admin, so the server makes the first one
-- at start while there is none (`bootstrap-admin`, see server/app.ts). Its
-- password is known (the README's, or ADMIN_PASSWORD) and works once: the
-- first login with it ends it and shows a new one, as a link back in does.
ALTER TABLE passwords DROP CONSTRAINT passwords_origin;
ALTER TABLE passwords ADD CONSTRAINT passwords_origin CHECK (origin IN ('first', 'reset', 'bootstrap'));
