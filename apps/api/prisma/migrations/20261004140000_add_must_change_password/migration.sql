-- Adds the "temporary password" reminder.
--
-- An administrator can now issue a one-time password for someone who has lost
-- theirs. Without a flag to record that, the generated password would quietly
-- become their permanent one, so the flag makes the state explicit and lets the
-- app keep reminding until the user replaces it.
--
-- DEFAULT false and NOT NULL, so this is a fast metadata-only change on Postgres
-- and existing rows are unaffected.
ALTER TABLE "users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
