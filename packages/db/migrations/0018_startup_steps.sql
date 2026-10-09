-- One-time steps the server takes at start (AND-330).
--
-- Some changes to stored data need the loaded packages, which a migration
-- does not see: the server takes such a step once, after it has loaded
-- them, and notes it here so it never takes it again. The note and the
-- change are written in one statement.
--
-- The first: every character gets the loaded extensions of its package
-- switched on (`extensions-on`). New characters have them on by default
-- since AND-330; switching one on changes no answer, it only adds options.
CREATE TABLE startup_steps (
  id text PRIMARY KEY,
  done_at timestamptz NOT NULL
);
