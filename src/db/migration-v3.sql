-- Migration for databases created BEFORE this update (v3).
-- A fresh deploy does NOT need this file — schema.sql already includes
-- everything below. Run this once against an existing D1 database:
--
--   wrangler d1 execute <your-db-name> --remote --file=src/db/migration-v3.sql
--
-- It is safe to run more than once (every statement is either idempotent or
-- errors harmlessly if already applied).

-- New table for the backend worker pool (requirement #4).
CREATE TABLE IF NOT EXISTS backend_pool (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL,
  label      TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  added_at   INTEGER NOT NULL
);

-- Daily request cap + kill switch settings (requirement #3).
INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_request_limit', '90000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('service_paused', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_pause_at_limit', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('usage_quota_date', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('usage_quota_count', '0');

-- Backend worker pool rotation settings (requirement #4).
INSERT OR IGNORE INTO settings (key, value) VALUES ('pool_batch_size', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('pool_rest_days', '1');

-- Forced Telegram channel join (requirement #6, 1st batch).
INSERT OR IGNORE INTO settings (key, value) VALUES ('required_channel', '@donatewirepubg');
INSERT OR IGNORE INTO settings (key, value) VALUES ('required_channel_url', 'https://t.me/donatewirepubg');

-- One-time-per-month bonus "Wiki" config VIP users can claim (requirement #6, 2nd batch).
INSERT OR IGNORE INTO settings (key, value) VALUES ('wiki_gift_link', '');

-- SQLite/D1 has no "ADD COLUMN IF NOT EXISTS" — ignore the error this throws
-- if you've already run this migration once (column already exists).
ALTER TABLE users ADD COLUMN wiki_gift_claimed_at INTEGER;

-- The old fake per-country "premium_locations" feature is removed — Cloudflare
-- Workers have no concept of exit-node country, so per-country configs were
-- never actually distinguishable. Delete the leftover setting if present.
DELETE FROM settings WHERE key = 'premium_locations';
