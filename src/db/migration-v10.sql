-- Migration v10: add an optional "country" label to the manually-entered
-- healthy IP list (clean_ips). Purely cosmetic/organizational — there is
-- still no scanning or testing of any kind (see migration-v9.sql). This
-- just lets the admin tag each entry (e.g. "DE", "TR", "AE") so the
-- dashboard table can show a flag/country next to it when they manage
-- several rented servers in different countries.
--
-- Safe to run multiple times; SQLite ignores ADD COLUMN if it already
-- exists only when wrapped like below via a defensive check is not
-- supported directly, so just run this once per database.
--
--   npx wrangler d1 execute <db-name> --remote --file=./src/db/migration-v10.sql

ALTER TABLE clean_ips ADD COLUMN country TEXT;
