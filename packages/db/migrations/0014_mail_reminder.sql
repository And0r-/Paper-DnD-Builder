-- A reminder to add a mail address (AND-241).
--
-- Without an address there is no way back in once every password is lost.
-- "My characters" says so once, to accounts without one; whoever answers
-- "Later" does not see it again, on any device. So the answer is kept on
-- the account, not in the browser. Nothing else is kept: not when, not how
-- often.
ALTER TABLE accounts ADD COLUMN mail_reminder_off boolean NOT NULL DEFAULT false;
