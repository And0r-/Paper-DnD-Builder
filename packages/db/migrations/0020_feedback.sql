-- Feedback from logged-in players (AND-354).
--
-- Whoever runs the builder wants to hear what is wrong and how it feels,
-- from the people using it, without a mail address or an outside service.
-- A player sends a text from the menu; the admin reads it, marks it done,
-- or deletes it. Nothing else comes with it but the page it was sent from
-- (its path only, never a query that could hold a token) and the language.
--
-- When the account goes, its feedback stays without it: the text was given
-- to the operator, and holds nothing that points back to the person.
CREATE TABLE feedback (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  kind text NOT NULL CONSTRAINT feedback_kind CHECK (kind IN ('wrong', 'idea', 'other')),
  rating smallint CONSTRAINT feedback_rating CHECK (rating BETWEEN 1 AND 5),
  text text NOT NULL,
  page text,
  language text NOT NULL,
  status text NOT NULL DEFAULT 'open' CONSTRAINT feedback_status CHECK (status IN ('open', 'done')),
  created_at timestamptz NOT NULL
);

-- The admin's list: open first by default, newest first.
CREATE INDEX feedback_status_created_at ON feedback (status, created_at DESC);
