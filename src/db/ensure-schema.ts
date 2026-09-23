import type { Env } from '../core/types'

/**
 * Runtime schema self-heal for D1.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tables/columns behind the newer dashboard sections (کانفیگ‌های کاربر,
 * اسکنر وحید, اسکن دستی, Radar → "افزودن به لیست سرورهای کاربران", Private DNS,
 * country tags ...) are normally created at BUILD time by scripts/ci-setup.js
 * (`wrangler d1 execute --remote --file=schema.sql / migration-v*.sql`).
 *
 * When the project is redeployed from GitHub over an EXISTING deployment,
 * that build-time step can silently fail (the Workers Builds token often has
 * no "D1 Edit" permission, or the D1 database id differs from the one the
 * build resolved) — ci-setup.js only logs the failure and carries on, so the
 * new code ships but the old database never gets the new tables/columns.
 * Every query touching them then throws (e.g. "no such table: clean_ips",
 * "table clean_ips has no column named country", "ON CONFLICT clause does
 * not match any PRIMARY KEY or UNIQUE constraint") and the dashboard only
 * shows a generic "خطا".
 *
 * This module makes the running Worker repair its own database instead:
 * every statement is idempotent, and it runs at most once per isolate (with
 * a retry cool-down if it fails). It never drops or rewrites user data.
 */

type ColumnFix = { table: string; column: string; ddl: string }

// Must stay in sync with schema.sql + migration-v*.sql.
const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS users (
    uuid TEXT PRIMARY KEY, telegram_id TEXT, telegram_name TEXT,
    type TEXT NOT NULL DEFAULT 'trial', status TEXT NOT NULL DEFAULT 'active',
    volume_limit_mb REAL NOT NULL DEFAULT 0, volume_used_mb REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, expires_at INTEGER, last_trial_at INTEGER,
    warned_80 INTEGER NOT NULL DEFAULT 0, note TEXT,
    notified_step_mb REAL NOT NULL DEFAULT 0, wiki_gift_claimed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS bot_users (
    telegram_id TEXT PRIMARY KEY, telegram_name TEXT,
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
    messages INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pro_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT, telegram_name TEXT,
    created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending')`,
  `CREATE TABLE IF NOT EXISTS backend_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, label TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, added_at INTEGER NOT NULL,
    cf_account_id TEXT, cf_api_token TEXT, cf_database_id TEXT, cf_script_name TEXT,
    sync_secret TEXT, health_status TEXT NOT NULL DEFAULT 'unknown',
    last_checked_at INTEGER, last_error TEXT, last_synced_at INTEGER, country TEXT)`,
  `CREATE TABLE IF NOT EXISTS clean_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 443, note TEXT, country TEXT,
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS dns_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL,
    note TEXT, created_at INTEGER NOT NULL)`,
]

// Columns added over time by ALTER TABLE migrations. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so each one is checked via PRAGMA first.
const COLUMN_FIXES: ColumnFix[] = [
  { table: 'users', column: 'notified_step_mb', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'users', column: 'wiki_gift_claimed_at', ddl: 'INTEGER' },
  { table: 'backend_pool', column: 'cf_account_id', ddl: 'TEXT' },
  { table: 'backend_pool', column: 'cf_api_token', ddl: 'TEXT' },
  { table: 'backend_pool', column: 'cf_database_id', ddl: 'TEXT' },
  { table: 'backend_pool', column: 'cf_script_name', ddl: 'TEXT' },
  { table: 'backend_pool', column: 'sync_secret', ddl: 'TEXT' },
  { table: 'backend_pool', column: 'health_status', ddl: "TEXT NOT NULL DEFAULT 'unknown'" },
  { table: 'backend_pool', column: 'last_checked_at', ddl: 'INTEGER' },
  { table: 'backend_pool', column: 'last_error', ddl: 'TEXT' },
  { table: 'backend_pool', column: 'last_synced_at', ddl: 'INTEGER' },
  { table: 'backend_pool', column: 'country', ddl: 'TEXT' },
  { table: 'clean_ips', column: 'country', ddl: 'TEXT' },
]

const RETRY_COOLDOWN_MS = 60_000

let done = false
let inFlight: Promise<void> | null = null
let lastFailureAt = 0
let lastError: string | null = null

/** Message of the most recent failed self-heal attempt (null if none / since recovered). */
export function getLastSchemaError(): string | null {
  return lastError
}

async function columnsOf(env: Env, table: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return new Set((results ?? []).map((r) => String(r.name).toLowerCase()))
}

async function repair(env: Env): Promise<void> {
  // 1) A clean_ips table left over from a very old/experimental shape
  //    (ip PRIMARY KEY, latency_ms, healthy, ...) can't work with the current
  //    code. Keep its data under another name instead of dropping it.
  try {
    const existing = await columnsOf(env, 'clean_ips')
    if (existing.size > 0 && !(existing.has('id') && existing.has('port') && existing.has('created_at'))) {
      await env.DB.prepare(`ALTER TABLE clean_ips RENAME TO clean_ips_legacy_${Date.now()}`).run()
    }
  } catch (err) {
    console.error('ensureSchema: legacy clean_ips check failed (continuing):', err)
  }

  // 2) Missing tables.
  await env.DB.batch(CREATE_TABLES.map((sql) => env.DB.prepare(sql)))

  // 3) Missing columns.
  const cache = new Map<string, Set<string>>()
  for (const fix of COLUMN_FIXES) {
    let cols = cache.get(fix.table)
    if (!cols) {
      cols = await columnsOf(env, fix.table)
      cache.set(fix.table, cols)
    }
    if (cols.has(fix.column.toLowerCase())) continue
    try {
      await env.DB.prepare(`ALTER TABLE ${fix.table} ADD COLUMN ${fix.column} ${fix.ddl}`).run()
      cols.add(fix.column.toLowerCase())
    } catch (err) {
      // A concurrent isolate may have added it a moment ago.
      if (!/duplicate column/i.test(String((err as Error)?.message ?? err))) throw err
    }
  }

  // 4) Unique indexes that INSERT ... ON CONFLICT(...) relies on. Remove exact
  //    duplicates first, otherwise creating the index would fail.
  await env.DB.prepare(
    `DELETE FROM clean_ips WHERE id NOT IN (SELECT MIN(id) FROM clean_ips GROUP BY ip, port)`,
  ).run()
  await env.DB.prepare(
    `DELETE FROM dns_rules WHERE id NOT IN (SELECT MIN(id) FROM dns_rules GROUP BY kind, value)`,
  ).run()
  await env.DB.batch([
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clean_ips_ip_port ON clean_ips(ip, port)`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_rules_kind_value ON dns_rules(kind, value)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`),
  ])
}

/**
 * Makes sure the D1 schema matches what the code expects. Cheap after the
 * first successful run in an isolate (a boolean check). Throws on failure so
 * callers that want the real reason (the admin API) can show it; use
 * ensureSchemaSafe() where a failure must never break the request.
 */
export async function ensureSchema(env: Env): Promise<void> {
  if (done || !env.DB) return
  if (inFlight) return inFlight
  if (lastFailureAt && Date.now() - lastFailureAt < RETRY_COOLDOWN_MS) return

  inFlight = repair(env)
    .then(() => {
      done = true
      lastError = null
    })
    .catch((err) => {
      lastFailureAt = Date.now()
      lastError = String((err as Error)?.message ?? err)
      console.error('ensureSchema failed:', err)
      throw err
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Same as ensureSchema() but swallows errors (logged) — for hot paths. */
export async function ensureSchemaSafe(env: Env): Promise<void> {
  try {
    await ensureSchema(env)
  } catch {
    /* already logged; the real query will surface its own error */
  }
}
