-- Migration for databases created BEFORE this update (v4).
-- A fresh deploy does NOT need this file — schema.sql already includes
-- everything below. This runs automatically on every deploy (scripts/ci-setup.js
-- picks up any src/db/migration-v*.sql file), so you do NOT need to run it by
-- hand — it's here for reference / manual runs only:
--
--   wrangler d1 execute <your-db-name> --remote --file=src/db/migration-v4.sql
--
-- It is safe to run more than once — every ALTER TABLE below errors
-- harmlessly with "duplicate column name" if already applied, and ci-setup
-- treats that as success.

-- Requirement #1 (3rd batch): turn `backend_pool` rows into full, manageable
-- Cloudflare accounts — each optionally health-checkable via the Cloudflare
-- API and able to receive synced VIP users so one subscription link works
-- across every account the admin registers. See src/services/cf-accounts.ts.
ALTER TABLE backend_pool ADD COLUMN cf_account_id TEXT;
ALTER TABLE backend_pool ADD COLUMN cf_api_token TEXT;
ALTER TABLE backend_pool ADD COLUMN cf_database_id TEXT;
ALTER TABLE backend_pool ADD COLUMN cf_script_name TEXT;
ALTER TABLE backend_pool ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE backend_pool ADD COLUMN last_checked_at INTEGER;
ALTER TABLE backend_pool ADD COLUMN last_error TEXT;
ALTER TABLE backend_pool ADD COLUMN last_synced_at INTEGER;
