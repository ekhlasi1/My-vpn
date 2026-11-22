-- Migration v5: simple worker-to-worker sync (requirement: easier multi-account setup)
--
-- Adds a much simpler alternative to the Cloudflare-API-token based sync in
-- migration-v4: instead of an admin having to create a scoped API token,
-- find their Account ID and D1 Database ID, and paste all three in, they can
-- now just paste the OTHER worker's URL + a secret that worker itself
-- generated and shows in its own dashboard. The remote worker verifies the
-- secret and writes to its own D1 locally — no Cloudflare account
-- credentials change hands at all.
--
-- Run this the same way as migration-v4:
--   npx wrangler d1 execute <db-name> --remote --file=./src/db/migration-v5.sql

ALTER TABLE backend_pool ADD COLUMN sync_secret TEXT;
