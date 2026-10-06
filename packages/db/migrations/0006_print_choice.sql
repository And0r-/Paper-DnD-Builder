-- What an account picked when it last downloaded a PDF: which parts
-- (sheet, cards, rules texts), which design, empty or filled in. The
-- download dialog starts from it next time. A setting like the units:
-- no history, overwritten by the next choice, deleted with the account.
-- The app reads missing or outdated fields as the default.

ALTER TABLE accounts ADD COLUMN print_choice jsonb NOT NULL DEFAULT '{}'::jsonb;
