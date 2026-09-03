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
  note            TEXT,
  notified_step_mb REAL NOT NULL DEFAULT 0,  -- last usage (MB) at which a "every N MB" notice was sent
  wiki_gift_claimed_at INTEGER               -- last time this user claimed the monthly VIP "Wiki" bonus config (req. #6)
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Every Telegram account that has ever messaged the bot, regardless of
-- whether they claimed a trial/pro subscription. Gives the admin dashboard
-- a full "leads" list, per project requirement #1.
CREATE TABLE IF NOT EXISTS bot_users (
  telegram_id    TEXT PRIMARY KEY,
  telegram_name  TEXT,
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  messages       INTEGER NOT NULL DEFAULT 1
);

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

-- Extra Cloudflare Workers/accounts that VIP users' extra configs can be
-- pointed at, in rotating rest/active batches — see getPoolRotation() in
-- src/db/queries.ts (req. #4). Rows can also represent a fully separate
-- Cloudflare ACCOUNT (req. #1, 3rd batch): give it its own API token +
-- account id + D1 database id and the admin panel can health-check it via
-- the Cloudflare API and mirror VIP users into its database, so the exact
-- same subscription UUID works on that account too. See
-- src/services/cf-accounts.ts.
CREATE TABLE IF NOT EXISTS backend_pool (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  url              TEXT NOT NULL,          -- e.g. https://my-worker-2.username.workers.dev
  label            TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  added_at         INTEGER NOT NULL,
  cf_account_id    TEXT,                   -- Cloudflare Account ID (legacy method, optional)
  cf_api_token     TEXT,                   -- Cloudflare API Token scoped to that account (legacy method, optional)
  cf_database_id   TEXT,                   -- that account's own D1 database id (legacy method, optional)
  cf_script_name   TEXT,                   -- the deployed Worker script name on that account (legacy method, optional)
  sync_secret      TEXT,                   -- preferred: that worker's OWN generated secret, see src/services/worker-sync.ts
  health_status    TEXT NOT NULL DEFAULT 'unknown', -- 'unknown' | 'healthy' | 'unhealthy'
  last_checked_at  INTEGER,
  last_error       TEXT,
  last_synced_at   INTEGER
);

-- Cloudflare edge IPs that were actually tested (from this worker, via the
-- `cf.resolveOverride` fetch option) and found reachable + fast, per
-- requirement #5 ("خودکار ای پی های جدید سالم برای لوکیشن ایران بده"). The
-- best healthy row is used as the VLESS `add=` (connect) address for every
-- generated config, while `host`/`sni` stay on the real worker domain — see
-- src/services/clean-ips.ts and requirement #4 (minimizing IP-level
-- filtering without breaking Cloudflare's SNI/Host based routing).
CREATE TABLE IF NOT EXISTS clean_ips (
  ip           TEXT PRIMARY KEY,
  latency_ms   INTEGER,
  healthy      INTEGER NOT NULL DEFAULT 0,
  last_checked INTEGER NOT NULL,
  last_error   TEXT,
  -- Cloudflare colo (data-center) airport code this IP last answered from
  -- (e.g. "FRA", "IST"), and a friendly country/city label for it when
  -- known — see src/services/clean-ips.ts's COLO_COUNTRY map.
  colo         TEXT,
  country      TEXT,
  -- Being "healthy" is not enough for an IP to actually be handed out to
  -- users (see getBestCleanIp) — it also has to be explicitly approved by
  -- the admin from the dashboard (requirement: "با تأیید نهایی من به لیست
  -- ربات اضافه بشه"). Auto-discovery only ever sets healthy/colo/country;
  -- it never sets this column.
  approved     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clean_ips_healthy ON clean_ips(healthy, latency_ms);
CREATE INDEX IF NOT EXISTS idx_clean_ips_approved ON clean_ips(approved, healthy, latency_ms);

-- Default admin dashboard password: %^a9v7j!es*3rs
-- INSERT OR IGNORE so this only applies on first deploy — once you change
-- the password from the dashboard (or this row already exists), it is never
-- overwritten by future deploys/schema re-applies.
INSERT OR IGNORE INTO settings (key, value)
VALUES ('admin_password_hash', '9f1e304414990950b6b36d44d7e02943:d5b310ae87ae7ecadedcdddb6b5b5ce088d4df2c9acd7dec188a86a5d43b7c99');

-- Every N MB of usage, the bot DMs the user their current consumption.
INSERT OR IGNORE INTO settings (key, value) VALUES ('usage_notify_step_mb', '400');

-- Editable display names for user-facing config entries (admin panel > تنظیمات تست).
-- Placeholders: {brand}, {admin}, {n} (pro only).
INSERT OR IGNORE INTO settings (key, value) VALUES ('pro_config_name', '👑 {brand} VIP | سرور {n} | @{admin}');
INSERT OR IGNORE INTO settings (key, value) VALUES ('trial_config_name', '{brand} | خرید: @{admin}');

-- Self-imposed daily request cap + kill switch, to stay safely under
-- Cloudflare's request limits (default: 90,000 of the Free plan's 100,000/day).
INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_request_limit', '90000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('service_paused', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_pause_at_limit', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('usage_quota_date', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('usage_quota_count', '0');

-- Backend worker pool rotation settings.
INSERT OR IGNORE INTO settings (key, value) VALUES ('pool_batch_size', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('pool_rest_days', '1');

-- Telegram channel users must join before using the bot.
INSERT OR IGNORE INTO settings (key, value) VALUES ('required_channel', '@donatewirepubg');
INSERT OR IGNORE INTO settings (key, value) VALUES ('required_channel_url', 'https://t.me/donatewirepubg');

-- One-time-per-month bonus "Wiki" config VIP users can claim from the bot (req. #6, 2nd batch).
-- Leave empty until the admin sets a real link from the dashboard.
INSERT OR IGNORE INTO settings (key, value) VALUES ('wiki_gift_link', '');

-- Public DNS routing list (see docs/private-dns-fa.md + migration-v7.sql):
-- domain / ip / cidr entries that the standalone DoT server (dot-server/)
-- fetches from GET /api/dns-rules and uses to decide, per query, whether to
-- answer with a Cloudflare "clean" IP (routed) or forward upstream untouched
-- (direct).
CREATE TABLE IF NOT EXISTS dns_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,          -- 'domain' | 'ip' | 'cidr'
  value      TEXT NOT NULL,          -- 'example.com', '*.example.com', '1.2.3.4', '1.2.3.0/24'
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_rules_kind_value ON dns_rules(kind, value);
