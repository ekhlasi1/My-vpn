-- FoxCloud / BNDMAX VPN dashboard schema (Cloudflare D1)

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
