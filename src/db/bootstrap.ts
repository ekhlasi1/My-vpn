import type { Env } from '../core/types'

/**
 * Runtime database bootstrap.
 *
 * Why this exists: the schema used to be applied ONLY by scripts/ci-setup.js
 * during `npm run build`. If that step failed silently (no API token
 * permission for D1, deploy through the dashboard "upload" flow, a freshly
 * created database, ...), the Worker deployed fine but every request to
 * "/" (the login page) crashed with "no such table: settings" and the
 * visitor only ever saw the generic "server error" page.
 *
 * Now the Worker makes sure the schema exists by itself, once per isolate.
 * Every statement is idempotent (IF NOT EXISTS / INSERT OR IGNORE), and the
 * column additions only run when the column is actually missing.
 */

export class DbMissingError extends Error {
  constructor() {
    super('D1 binding "DB" is not attached to this Worker')
    this.name = 'DbMissingError'
  }
}

// NOTE: the default admin password hash below is the SAME one that has always
// shipped in src/db/schema.sql (it is not a new credential). INSERT OR IGNORE
// means an already-changed password is never overwritten.
const DEFAULT_ADMIN_PASSWORD_HASH =
  '9f1e304414990950b6b36d44d7e02943:d5b310ae87ae7ecadedcdddb6b5b5ce088d4df2c9acd7dec188a86a5d43b7c99'

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    uuid            TEXT PRIMARY KEY,
    telegram_id     TEXT,
    telegram_name   TEXT,
    type            TEXT NOT NULL DEFAULT 'trial',
    status          TEXT NOT NULL DEFAULT 'active',
    volume_limit_mb REAL NOT NULL DEFAULT 0,
    volume_used_mb  REAL NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER,
    last_trial_at   INTEGER,
    warned_80       INTEGER NOT NULL DEFAULT 0,
    note            TEXT,
    notified_step_mb REAL NOT NULL DEFAULT 0,
    wiki_gift_claimed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS bot_users (
    telegram_id    TEXT PRIMARY KEY,
    telegram_name  TEXT,
    first_seen     INTEGER NOT NULL,
    last_seen      INTEGER NOT NULL,
    messages       INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pro_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    telegram_name TEXT,
    created_at  INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
  )`,
  `CREATE TABLE IF NOT EXISTS backend_pool (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    url              TEXT NOT NULL,
    label            TEXT,
    enabled          INTEGER NOT NULL DEFAULT 1,
    added_at         INTEGER NOT NULL,
    cf_account_id    TEXT,
    cf_api_token     TEXT,
    cf_database_id   TEXT,
    cf_script_name   TEXT,
    sync_secret      TEXT,
    health_status    TEXT NOT NULL DEFAULT 'unknown',
    last_checked_at  INTEGER,
    last_error       TEXT,
    last_synced_at   INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS clean_ips (
    ip           TEXT PRIMARY KEY,
    latency_ms   INTEGER,
    healthy      INTEGER NOT NULL DEFAULT 0,
    last_checked INTEGER NOT NULL,
    last_error   TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS dns_rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    value      TEXT NOT NULL,
    note       TEXT,
    created_at INTEGER NOT NULL
  )`,
]

const DEFAULT_SETTINGS: [string, string][] = [
  ['usage_notify_step_mb', '400'],
  ['pro_config_name', '👑 {brand} VIP | سرور {n} | @{admin}'],
  ['trial_config_name', '{brand} | خرید: @{admin}'],
  ['daily_request_limit', '90000'],
  ['service_paused', '0'],
  ['auto_pause_at_limit', '1'],
  ['usage_quota_date', ''],
  ['usage_quota_count', '0'],
  ['pool_batch_size', '5'],
  ['pool_rest_days', '1'],
  ['required_channel', '@donatewirepubg'],
  ['required_channel_url', 'https://t.me/donatewirepubg'],
  ['wiki_gift_link', ''],
]

// Every table's columns (besides the primary key). An older database may have
// the table but lack some of these; `CREATE TABLE IF NOT EXISTS` would silently
// skip it and a later index/query would die with "no such column". Missing
// columns are added before anything else touches them. (SQLite requires a
// DEFAULT on every NOT NULL column added this way.)
const TABLE_COLUMNS: Record<string, [string, string][]> = {
  settings: [['value', 'TEXT']],
  users: [
    ['telegram_id', 'TEXT'], ['telegram_name', 'TEXT'],
    ['type', "TEXT NOT NULL DEFAULT 'trial'"], ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['volume_limit_mb', 'REAL NOT NULL DEFAULT 0'], ['volume_used_mb', 'REAL NOT NULL DEFAULT 0'],
    ['created_at', 'INTEGER NOT NULL DEFAULT 0'], ['expires_at', 'INTEGER'], ['last_trial_at', 'INTEGER'],
    ['warned_80', 'INTEGER NOT NULL DEFAULT 0'], ['note', 'TEXT'],
    ['notified_step_mb', 'REAL NOT NULL DEFAULT 0'], ['wiki_gift_claimed_at', 'INTEGER'],
  ],
  bot_users: [
    ['telegram_name', 'TEXT'], ['first_seen', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_seen', 'INTEGER NOT NULL DEFAULT 0'], ['messages', 'INTEGER NOT NULL DEFAULT 1'],
  ],
  admin_sessions: [['created_at', 'INTEGER NOT NULL DEFAULT 0'], ['expires_at', 'INTEGER NOT NULL DEFAULT 0']],
  pro_requests: [
    ['telegram_id', 'TEXT'], ['telegram_name', 'TEXT'],
    ['created_at', 'INTEGER NOT NULL DEFAULT 0'], ['status', "TEXT NOT NULL DEFAULT 'pending'"],
  ],
  backend_pool: [
    ['url', "TEXT NOT NULL DEFAULT ''"], ['label', 'TEXT'], ['enabled', 'INTEGER NOT NULL DEFAULT 1'],
    ['added_at', 'INTEGER NOT NULL DEFAULT 0'], ['cf_account_id', 'TEXT'], ['cf_api_token', 'TEXT'],
    ['cf_database_id', 'TEXT'], ['cf_script_name', 'TEXT'], ['sync_secret', 'TEXT'],
    ['health_status', "TEXT NOT NULL DEFAULT 'unknown'"], ['last_checked_at', 'INTEGER'],
    ['last_error', 'TEXT'], ['last_synced_at', 'INTEGER'],
  ],
  dns_rules: [
    ['kind', "TEXT NOT NULL DEFAULT ''"], ['value', "TEXT NOT NULL DEFAULT ''"],
    ['note', 'TEXT'], ['created_at', 'INTEGER NOT NULL DEFAULT 0'],
  ],
}

// clean_ips is only a cache of probe results (rebuilt automatically every few
// minutes), so if an old version left it with a different shape it is simply
// dropped and recreated instead of being patched column by column.
const CLEAN_IPS_COLUMNS = ['ip', 'latency_ms', 'healthy', 'last_checked', 'last_error']

const INDEX_STATEMENTS: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`,
  `CREATE INDEX IF NOT EXISTS idx_clean_ips_healthy ON clean_ips(healthy, latency_ms)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_rules_kind_value ON dns_rules(kind, value)`,
]

async function existingColumns(db: D1Database, table: string): Promise<Set<string>> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return new Set((results ?? []).map((r) => r.name))
}

async function applyBootstrap(env: Env): Promise<void> {
  const db = env.DB

  // 1) Tables that do not exist yet.
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)))

  // 2) Repair tables that already existed with an older/different shape.
  const cleanCols = await existingColumns(db, 'clean_ips')
  if (CLEAN_IPS_COLUMNS.some((c) => !cleanCols.has(c))) {
    const create = SCHEMA_STATEMENTS.find((q) => q.includes('CREATE TABLE IF NOT EXISTS clean_ips'))!
    await db.batch([db.prepare('DROP TABLE IF EXISTS clean_ips'), db.prepare(create)])
  }

  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const have = await existingColumns(db, table)
    for (const [name, ddl] of columns) {
      if (have.has(name)) continue
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`).run()
      } catch (err) {
        // Another isolate may have added it a moment ago — harmless.
        if (!/duplicate column/i.test(String(err))) throw err
      }
    }
  }

  // 3) Indexes only speed things up, so one failing must never take the app
  //    down (an old table may have a column of a different meaning, etc.).
  for (const sql of INDEX_STATEMENTS) {
    try {
      await db.prepare(sql).run()
    } catch (err) {
      console.error('bootstrap: index skipped:', sql.slice(0, 80), String(err))
    }
  }

  // 4) Default settings (never overwrites existing values).
  const seed = [
    db
      .prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
      .bind('admin_password_hash', DEFAULT_ADMIN_PASSWORD_HASH),
    ...DEFAULT_SETTINGS.map(([k, v]) =>
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(k, v),
    ),
  ]
  await db.batch(seed)
}

let ready: Promise<void> | null = null

/**
 * Resolves once the D1 schema is in place. Throws DbMissingError when the DB
 * binding itself is absent. Runs at most once per isolate; a failure is not
 * cached, so the next request simply tries again.
 */
export function ensureDatabase(env: Env): Promise<void> {
  if (!env.DB) return Promise.reject(new DbMissingError())
  if (!ready) {
    ready = applyBootstrap(env).catch((err) => {
      ready = null
      throw err
    })
  }
  return ready
}

/** Non-throwing status snapshot used by GET /health. */
export async function databaseStatus(env: Env): Promise<{ bound: boolean; ready: boolean; error?: string }> {
  if (!env.DB) return { bound: false, ready: false, error: 'D1 binding "DB" is missing' }
  try {
    await ensureDatabase(env)
    await env.DB.prepare('SELECT 1 FROM settings LIMIT 1').first()
    return { bound: true, ready: true }
  } catch (err) {
    const cause = (err as { cause?: { message?: string } } | null)?.cause?.message
    const msg = err instanceof Error ? err.message : String(err)
    return { bound: true, ready: false, error: cause ? `${msg} | cause: ${cause}` : msg }
  }
}
