-- Migration for databases created BEFORE this update.
-- A fresh deploy does NOT need this file — schema.sql already includes
-- everything below. Run this once, only if `wrangler d1 execute` against
-- your existing D1 database fails on the new schema.sql because the
-- `users` table already exists without the `notified_step_mb` column.
--
--   wrangler d1 execute <your-db-name> --remote --file=src/db/migration-v2.sql
--
-- It is safe to run more than once (each statement is a no-op the second time
-- except the ALTER TABLE, which will simply error harmlessly if already applied).

ALTER TABLE users ADD COLUMN notified_step_mb REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bot_users (
  telegram_id    TEXT PRIMARY KEY,
  telegram_name  TEXT,
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  messages       INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('usage_notify_step_mb', '400');

INSERT OR IGNORE INTO settings (key, value) VALUES ('premium_locations', '[
  {"code":"DE","flag":"\ud83c\udde9\ud83c\uddea","name":"Germany"},
  {"code":"AE","flag":"\ud83c\udde6\ud83c\uddea","name":"UAE"},
  {"code":"US","flag":"\ud83c\uddfa\ud83c\uddf8","name":"USA"},
  {"code":"TR","flag":"\ud83c\uddf9\ud83c\uddf7","name":"Turkey"}
]');
