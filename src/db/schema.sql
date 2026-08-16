-- BNDMAX VPN dashboard schema (Cloudflare D1)

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  uuid            TEXT PRIMARY KEY,
  telegram_id     TEXT,
  telegram_name   TEXT,
  type            TEXT NOT NULL DEFAULT 'trial',   -- 'trial' | 'pro'
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'expired' | 'disabled'
  volume_limit_mb REAL NOT NULL DEFAULT 0,          -- 0 = unlimited
  volume_used_mb  REAL NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER,                          -- unix ms, NULL = never
  last_trial_at   INTEGER,
  warned_80       INTEGER NOT NULL DEFAULT 0,
  note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pro_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT,
  telegram_name TEXT,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' -- 'pending' | 'done'
);

-- Default admin dashboard password: %^a9v7j!es*3rs
-- INSERT OR IGNORE so this only applies on first deploy — once you change
-- the password from the dashboard (or this row already exists), it is never
-- overwritten by future deploys/schema re-applies.
INSERT OR IGNORE INTO settings (key, value)
VALUES ('admin_password_hash', '9f1e304414990950b6b36d44d7e02943:d5b310ae87ae7ecadedcdddb6b5b5ce088d4df2c9acd7dec188a86a5d43b7c99');
