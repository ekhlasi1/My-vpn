import type { Env } from '../core/types'
import { syncUserToAccount, removeUserFromAccount, checkAccountHealth, type CfAccountTarget, type SyncableUser } from '../services/cf-accounts'
import { syncUserToWorker, removeUserFromWorker, checkWorkerSyncHealth, type WorkerSyncTarget } from '../services/worker-sync'
import { generateRandomToken } from '../auth/password'

export interface UserRow {
  uuid: string
  telegram_id: string | null
  telegram_name: string | null
  type: 'trial' | 'pro'
  status: 'active' | 'expired' | 'disabled'
  volume_limit_mb: number
  volume_used_mb: number
  created_at: number
  expires_at: number | null
  last_trial_at: number | null
  warned_80: number
  note: string | null
  notified_step_mb: number
  wiki_gift_claimed_at: number | null
}

// ==================== Settings ====================

const SETTINGS_DEFAULTS: Record<string, string> = {
  trial_duration_hours: '24',
  trial_volume_mb: '2048',
  trial_cooldown_hours: '24',
  telegram_bot_token: '',
  telegram_admin_id: '',
  telegram_admin_username: 'vahidekhlasi',
  brand_name: 'BNDMAX VPN',
  usage_notify_step_mb: '400',
  // ---- Requirement #3: self-imposed daily request cap + kill switch ----
  // Cloudflare's Workers Free plan allows 100,000 requests/day; we default the
  // soft cap to 90,000 (90%) so the service pauses itself before Cloudflare
  // ever throttles/suspends the worker. Adjust from the dashboard if you're
  // on a paid plan with a higher ceiling.
  daily_request_limit: '90000',
  service_paused: '0',
  auto_pause_at_limit: '1',
  usage_quota_date: '',
  usage_quota_count: '0',
  // ---- Requirement #4: extra backend worker pool (rotation + rest) ----
  pool_batch_size: '5',
  pool_rest_days: '1',
  // ---- Requirement #6: force-join a Telegram channel before bot use ----
  required_channel: '@donatewirepubg',
  required_channel_url: 'https://t.me/donatewirepubg',
  // ---- Requirement #6 (2nd batch): one-time monthly "Wiki" bonus config for VIP users ----
  wiki_gift_link: '',
}

export async function getSetting(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  if (row && row.value !== null && row.value !== undefined) return row.value
  return SETTINGS_DEFAULTS[key] ?? ''
}

export async function getAllSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{
    key: string
    value: string
  }>()
  const out: Record<string, string> = { ...SETTINGS_DEFAULTS }
  for (const r of results ?? []) out[r.key] = r.value
  return out
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, value)
    .run()
}

export async function setSettings(env: Env, values: Record<string, string>): Promise<void> {
  const stmts = Object.entries(values).map(([k, v]) =>
    env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).bind(k, v),
  )
  if (stmts.length) await env.DB.batch(stmts)
}

export async function hasAdminPassword(env: Env): Promise<boolean> {
  const hash = await getSetting(env, 'admin_password_hash')
  return !!hash
}

/**
 * This worker's own secret for the simple worker-to-worker sync method
 * (migration-v5 / requirement: easier multi-account setup). Any OTHER
 * account's dashboard that gets this value + this worker's URL can add this
 * worker to its pool and push synced users to it — no Cloudflare API token
 * or D1 Database ID required at all, see src/services/worker-sync.ts.
 * Generated lazily on first read so upgraders don't need a manual step.
 */
export async function getOrCreateWorkerSyncSecret(env: Env): Promise<string> {
  const existing = await getSetting(env, 'worker_sync_secret')
  if (existing) return existing
  const fresh = generateRandomToken(32)
  await setSetting(env, 'worker_sync_secret', fresh)
  return fresh
}

/** Issues a brand-new secret, invalidating the old one immediately. */
export async function regenerateWorkerSyncSecret(env: Env): Promise<string> {
  const fresh = generateRandomToken(32)
  await setSetting(env, 'worker_sync_secret', fresh)
  return fresh
}

// ==================== Users ====================

export async function getUserByUuid(env: Env, uuid: string): Promise<UserRow | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE uuid = ?').bind(uuid).first<UserRow>()
  return row ?? null
}

export async function getUserByTelegramId(env: Env, telegramId: string): Promise<UserRow | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM users WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(telegramId)
    .first<UserRow>()
  return row ?? null
}

/**
 * Returns EVERY subscription a Telegram user has (trial and pro are
 * separate rows, one per uuid) — required so trial usage and VIP usage are
 * always calculated and shown independently instead of one hiding the other.
 */
export async function getUsersByTelegramId(env: Env, telegramId: string): Promise<UserRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM users WHERE telegram_id = ? ORDER BY created_at DESC',
  )
    .bind(telegramId)
    .all<UserRow>()
  return results ?? []
}

/** The user's most recent subscription of a specific type (trial vs pro), used for trial-cooldown checks etc. */
export async function getUserByTelegramIdAndType(
  env: Env,
  telegramId: string,
  type: 'trial' | 'pro',
): Promise<UserRow | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM users WHERE telegram_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(telegramId, type)
    .first<UserRow>()
  return row ?? null
}

export async function listUsers(env: Env, limit = 500): Promise<UserRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<UserRow>()
  return results ?? []
}

export async function createUser(env: Env, user: Partial<UserRow> & { uuid: string }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users
      (uuid, telegram_id, telegram_name, type, status, volume_limit_mb, volume_used_mb, created_at, expires_at, last_trial_at, warned_80, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      user.uuid,
      user.telegram_id ?? null,
      user.telegram_name ?? null,
      user.type ?? 'trial',
      user.status ?? 'active',
      user.volume_limit_mb ?? 0,
      user.volume_used_mb ?? 0,
      user.created_at ?? Date.now(),
      user.expires_at ?? null,
      user.last_trial_at ?? null,
      user.warned_80 ?? 0,
      user.note ?? null,
    )
    .run()

  // Requirement #1 (3rd batch): the moment a trial/VIP user is created, mirror
  // them into every other fully-configured Cloudflare account so their one
  // subscription link is valid everywhere immediately — never blocks/fails
  // the primary creation if a remote account is unreachable.
  await syncUserToAllAccounts(env, {
    uuid: user.uuid,
    telegram_id: user.telegram_id ?? null,
    telegram_name: user.telegram_name ?? null,
    type: user.type ?? 'trial',
    status: user.status ?? 'active',
    volume_limit_mb: user.volume_limit_mb ?? 0,
    volume_used_mb: user.volume_used_mb ?? 0,
    created_at: user.created_at ?? Date.now(),
    expires_at: user.expires_at ?? null,
  }).catch((err) => console.error('syncUserToAllAccounts (create) failed:', err))
}

export async function updateUser(env: Env, uuid: string, fields: Partial<UserRow>): Promise<void> {
  const keys = Object.keys(fields)
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  const values = keys.map((k) => (fields as Record<string, unknown>)[k])
  await env.DB.prepare(`UPDATE users SET ${sets} WHERE uuid = ?`)
    .bind(...values, uuid)
    .run()

  // Requirement #1 (3rd batch): keep every synced account's copy (status,
  // expiry, volume, type) in step with edits/renewals made here.
  const updatedRow = await env.DB.prepare('SELECT * FROM users WHERE uuid = ?').bind(uuid).first<UserRow>()
  if (updatedRow) {
    await syncUserToAllAccounts(env, {
      uuid: updatedRow.uuid,
      telegram_id: updatedRow.telegram_id,
      telegram_name: updatedRow.telegram_name,
      type: updatedRow.type,
      status: updatedRow.status,
      volume_limit_mb: updatedRow.volume_limit_mb,
      volume_used_mb: updatedRow.volume_used_mb,
      created_at: updatedRow.created_at,
      expires_at: updatedRow.expires_at,
    }).catch((err) => console.error('syncUserToAllAccounts (update) failed:', err))
  }
}

export async function deleteUser(env: Env, uuid: string): Promise<void> {
  await env.DB.prepare('DELETE FROM users WHERE uuid = ?').bind(uuid).run()
  await removeUserFromAllAccounts(env, uuid).catch((err) => console.error('removeUserFromAllAccounts failed:', err))
}

/**
 * Writes an incoming synced user directly into THIS worker's own D1 — used
 * only by the /api/pool/sync-user endpoint when another account's dashboard
 * pushes a user here via the simple worker-sync method (see
 * src/services/worker-sync.ts). Does NOT re-trigger syncUserToAllAccounts —
 * a synced copy must never fan back out to other accounts itself.
 */
export async function upsertSyncedUser(env: Env, user: SyncableUser): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (uuid, telegram_id, telegram_name, type, status, volume_limit_mb, volume_used_mb, created_at, expires_at, warned_80, notified_step_mb)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
     ON CONFLICT(uuid) DO UPDATE SET
       telegram_id = excluded.telegram_id,
       telegram_name = excluded.telegram_name,
       type = excluded.type,
       status = excluded.status,
       volume_limit_mb = excluded.volume_limit_mb,
       expires_at = excluded.expires_at`,
  )
    .bind(
      user.uuid,
      user.telegram_id,
      user.telegram_name,
      user.type,
      user.status,
      user.volume_limit_mb,
      user.volume_used_mb,
      user.created_at,
      user.expires_at,
    )
    .run()
}

/** Removes a synced user from THIS worker's own D1 — mirror of upsertSyncedUser. */
export async function deleteSyncedUser(env: Env, uuid: string): Promise<void> {
  await env.DB.prepare('DELETE FROM users WHERE uuid = ?').bind(uuid).run()
}

export async function addUsage(env: Env, uuid: string, mb: number): Promise<void> {
  if (mb <= 0) return
  await env.DB.prepare('UPDATE users SET volume_used_mb = volume_used_mb + ? WHERE uuid = ?')
    .bind(mb, uuid)
    .run()
}

export async function getExpiringTrialCandidates(env: Env): Promise<UserRow[]> {
  const now = Date.now()
  const { results } = await env.DB.prepare(
    `SELECT * FROM users WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?`,
  )
    .bind(now)
    .all<UserRow>()
  return results ?? []
}

export async function getOverQuotaCandidates(env: Env): Promise<UserRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM users WHERE status = 'active' AND volume_limit_mb > 0 AND volume_used_mb >= volume_limit_mb`,
  ).all<UserRow>()
  return results ?? []
}

export async function get80PercentCandidates(env: Env): Promise<UserRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM users
     WHERE status = 'active' AND warned_80 = 0 AND volume_limit_mb > 0
       AND volume_used_mb >= (volume_limit_mb * 0.8)`,
  ).all<UserRow>()
  return results ?? []
}

// ==================== Admin sessions ====================

export async function createSession(env: Env, token: string, ttlMs: number): Promise<void> {
  const now = Date.now()
  await env.DB.prepare('INSERT INTO admin_sessions (token, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(token, now, now + ttlMs)
    .run()
}

export async function isSessionValid(env: Env, token: string): Promise<boolean> {
  if (!token) return false
  const row = await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token = ?')
    .bind(token)
    .first<{ expires_at: number }>()
  if (!row) return false
  return row.expires_at > Date.now()
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run()
}

export async function addProRequest(env: Env, telegramId: string, telegramName: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO pro_requests (telegram_id, telegram_name, created_at, status) VALUES (?, ?, ?, ?)',
  )
    .bind(telegramId, telegramName, Date.now(), 'pending')
    .run()
}

// ==================== Bot users (everyone who ever messaged the bot) ====================

export interface BotUserRow {
  telegram_id: string
  telegram_name: string | null
  first_seen: number
  last_seen: number
  messages: number
}

/** Records/updates every Telegram account that messages the bot, regardless of subscription state. */
export async function upsertBotUser(env: Env, telegramId: string, telegramName: string): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO bot_users (telegram_id, telegram_name, first_seen, last_seen, messages)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(telegram_id) DO UPDATE SET
       telegram_name = excluded.telegram_name,
       last_seen = excluded.last_seen,
       messages = messages + 1`,
  )
    .bind(telegramId, telegramName, now, now)
    .run()
}

export async function listBotUsers(env: Env, limit = 1000): Promise<BotUserRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM bot_users ORDER BY last_seen DESC LIMIT ?')
    .bind(limit)
    .all<BotUserRow>()
  return results ?? []
}

// ==================== Usage-step notifications ====================

/** Marks the MB level at which the last "every N MB" usage notice was sent. */
export async function setNotifiedStep(env: Env, uuid: string, stepMb: number): Promise<void> {
  await env.DB.prepare('UPDATE users SET notified_step_mb = ? WHERE uuid = ?').bind(stepMb, uuid).run()
}

// ==================== Daily request quota + kill switch (requirement #3) ====================
// Cloudflare Workers (Free plan) allow a bounded number of requests/day. To
// avoid ever being throttled or suspended for going over that, we count every
// proxy connection attempt in the `settings` table (reset automatically the
// first time a new UTC day is seen) and expose the running total + a manual
// pause/resume switch on the admin dashboard.

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

export interface QuotaStatus {
  date: string
  count: number
  limit: number
  paused: boolean
  autoPause: boolean
}

export async function getQuotaStatus(env: Env): Promise<QuotaStatus> {
  const settings = await getAllSettings(env)
  const date = settings.usage_quota_date || todayUtc()
  const count = date === todayUtc() ? parseFloat(settings.usage_quota_count) || 0 : 0
  return {
    date: todayUtc(),
    count,
    limit: parseFloat(settings.daily_request_limit) || 90000,
    paused: settings.service_paused === '1',
    autoPause: settings.auto_pause_at_limit !== '0',
  }
}

/**
 * Increments today's request counter (resetting it first if the UTC day
 * rolled over) and, if auto-pause is enabled and the counter just crossed
 * the configured daily limit, flips the kill switch on automatically.
 * Returns true if the connection should be allowed to proceed.
 */
export async function checkAndIncrementQuota(env: Env): Promise<{ allowed: boolean; paused: boolean }> {
  const settings = await getAllSettings(env)
  if (settings.service_paused === '1') return { allowed: false, paused: true }

  const today = todayUtc()
  const sameDay = settings.usage_quota_date === today
  const nextCount = (sameDay ? parseFloat(settings.usage_quota_count) || 0 : 0) + 1
  const limit = parseFloat(settings.daily_request_limit) || 90000
  const autoPause = settings.auto_pause_at_limit !== '0'
  const overLimit = limit > 0 && nextCount >= limit

  const toSave: Record<string, string> = { usage_quota_date: today, usage_quota_count: String(nextCount) }
  if (overLimit && autoPause) toSave.service_paused = '1'
  await setSettings(env, toSave)

  return { allowed: !(overLimit && autoPause), paused: overLimit && autoPause }
}

export async function setServicePaused(env: Env, paused: boolean): Promise<void> {
  await setSetting(env, 'service_paused', paused ? '1' : '0')
}

// ==================== Backend worker pool (requirement #4) ====================
// Lets the admin register other Cloudflare Workers running the same codebase
// (deployed separately, sharing this same D1 database) and have VIP users'
// extra configs point at them in rotating batches, so no single worker
// carries all the VIP traffic and each batch gets a "rest" period.

export interface PoolWorkerRow {
  id: number
  url: string
  label: string | null
  enabled: number
  added_at: number
  // ---- Multi Cloudflare-account fields (requirement #1, 3rd batch) ----
  // All optional: a row with only `url` still works exactly like before
  // (just an extra worker to spread configs across). Filling in the rest
  // turns it into a fully managed *account* — health-checkable via the
  // Cloudflare API, and able to receive synced VIP users so the same
  // subscription link works there too. See src/services/cf-accounts.ts.
  cf_account_id: string | null
  cf_api_token: string | null
  cf_database_id: string | null
  cf_script_name: string | null
  // ---- Simple worker-to-worker sync (requirement: easier multi-account
  // setup, migration-v5). The preferred method: just the OTHER worker's own
  // generated secret (from ITS "🖧 پنل‌ها" tab). No Cloudflare credentials
  // needed. Whenever both this AND the cf_* fields are set, sync_secret
  // wins — see toSyncTarget()/toCfTarget() below.
  sync_secret: string | null
  health_status: 'unknown' | 'healthy' | 'unhealthy'
  last_checked_at: number | null
  last_error: string | null
  last_synced_at: number | null
}

export interface PoolWorkerInput {
  url: string
  label?: string | null
  cf_account_id?: string | null
  cf_api_token?: string | null
  cf_database_id?: string | null
  cf_script_name?: string | null
  sync_secret?: string | null
}

export async function listPoolWorkers(env: Env): Promise<PoolWorkerRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM backend_pool ORDER BY id ASC').all<PoolWorkerRow>()
  return results ?? []
}

export async function getPoolWorker(env: Env, id: number): Promise<PoolWorkerRow | null> {
  return (
    (await env.DB.prepare('SELECT * FROM backend_pool WHERE id = ?').bind(id).first<PoolWorkerRow>()) ?? null
  )
}

export async function addPoolWorker(env: Env, input: PoolWorkerInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO backend_pool
      (url, label, enabled, added_at, cf_account_id, cf_api_token, cf_database_id, cf_script_name, sync_secret, health_status)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'unknown')`,
  )
    .bind(
      input.url,
      input.label ?? null,
      Date.now(),
      input.cf_account_id ?? null,
      input.cf_api_token ?? null,
      input.cf_database_id ?? null,
      input.cf_script_name ?? null,
      input.sync_secret ?? null,
    )
    .run()
}

/** Updates any subset of an account's stored fields (used by the edit form + health-check writes). */
export async function updatePoolWorker(env: Env, id: number, fields: Partial<PoolWorkerRow>): Promise<void> {
  const keys = Object.keys(fields)
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  const values = keys.map((k) => (fields as Record<string, unknown>)[k])
  await env.DB.prepare(`UPDATE backend_pool SET ${sets} WHERE id = ?`)
    .bind(...values, id)
    .run()
}

export async function removePoolWorker(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM backend_pool WHERE id = ?').bind(id).run()
}

export async function setPoolWorkerEnabled(env: Env, id: number, enabled: boolean): Promise<void> {
  await env.DB.prepare('UPDATE backend_pool SET enabled = ? WHERE id = ?').bind(enabled ? 1 : 0, id).run()
}

function toCfTarget(row: PoolWorkerRow): CfAccountTarget {
  return {
    id: row.id,
    url: row.url,
    cf_account_id: row.cf_account_id,
    cf_api_token: row.cf_api_token,
    cf_database_id: row.cf_database_id,
    cf_script_name: row.cf_script_name,
  }
}

function toSyncTarget(row: PoolWorkerRow): WorkerSyncTarget {
  return { id: row.id, url: row.url, sync_secret: row.sync_secret as string }
}

/** True when a row is set up for the simple secret-based sync (preferred over the CF-token method). */
function usesSimpleSync(row: PoolWorkerRow): boolean {
  return !!row.sync_secret
}

/** True when a row has full legacy Cloudflare-API-token credentials. */
function usesCfTokenSync(row: PoolWorkerRow): boolean {
  return !!(row.cf_api_token && row.cf_account_id && row.cf_database_id)
}

/**
 * Mirrors one VIP/trial user into every enabled, sync-configured account —
 * via the simple worker-secret method when `sync_secret` is set (preferred,
 * requirement: easier multi-account setup), falling back to the legacy
 * Cloudflare-API-token + D1 method otherwise. So the subscription UUID this
 * project just issued is also valid on those other accounts' workers.
 * Called right after a user is created/renewed/edited (see telegram/bot.ts
 * and api/admin.ts). Never throws — a sync failure on one account is logged
 * and skipped, it must never break issuing the subscription on the primary
 * account.
 */
export async function syncUserToAllAccounts(env: Env, user: SyncableUser): Promise<void> {
  const accounts = await listPoolWorkers(env)
  const targets = accounts.filter((a) => a.enabled && (usesSimpleSync(a) || usesCfTokenSync(a)))
  await Promise.all(
    targets.map(async (row) => {
      try {
        if (usesSimpleSync(row)) {
          await syncUserToWorker(toSyncTarget(row), user)
        } else {
          await syncUserToAccount(toCfTarget(row), user)
        }
        await updatePoolWorker(env, row.id, { last_synced_at: Date.now() })
      } catch (err) {
        console.error(`syncUserToAllAccounts: account #${row.id} (${row.label || row.url}) failed:`, err)
      }
    }),
  )
}

/** Mirrors a user deletion/revoke across every synced account. Never throws. */
export async function removeUserFromAllAccounts(env: Env, uuid: string): Promise<void> {
  const accounts = await listPoolWorkers(env)
  const targets = accounts.filter((a) => a.enabled && (usesSimpleSync(a) || usesCfTokenSync(a)))
  await Promise.all(
    targets.map(async (row) => {
      try {
        if (usesSimpleSync(row)) {
          await removeUserFromWorker(toSyncTarget(row), uuid)
        } else {
          await removeUserFromAccount(toCfTarget(row), uuid)
        }
      } catch (err) {
        console.error(`removeUserFromAllAccounts: account #${row.id} (${row.label || row.url}) failed:`, err)
      }
    }),
  )
}

/**
 * Runs (and stores) a live health check for one account — via the simple
 * secret ping when configured (see checkWorkerSyncHealth() in
 * worker-sync.ts), otherwise the legacy Cloudflare API check (see
 * checkAccountHealth() in cf-accounts.ts).
 */
export async function checkAndStorePoolWorkerHealth(env: Env, id: number): Promise<PoolWorkerRow | null> {
  const row = await getPoolWorker(env, id)
  if (!row) return null
  const result = usesSimpleSync(row) ? await checkWorkerSyncHealth(toSyncTarget(row)) : await checkAccountHealth(toCfTarget(row))
  await updatePoolWorker(env, id, {
    health_status: result.healthy ? 'healthy' : 'unhealthy',
    last_checked_at: result.checked_at,
    last_error: result.error,
  })
  return getPoolWorker(env, id)
}

/**
 * Returns the hostnames of the pool workers that are "active" right now, plus
 * the full pool annotated with each worker's active/resting state (for the
 * dashboard). Enabled workers are split into batches of `pool_batch_size`;
 * one batch is active at a time and rotates to the next batch every
 * `pool_rest_days` days, so every worker gets rest between active periods.
 */
export async function getPoolRotation(
  env: Env,
): Promise<{ activeHosts: string[]; pool: (PoolWorkerRow & { active: boolean; hostname: string })[] }> {
  const [all, settings] = await Promise.all([listPoolWorkers(env), getAllSettings(env)])
  const enabled = all.filter((w) => w.enabled)
  const batchSize = Math.max(1, parseInt(settings.pool_batch_size, 10) || 5)
  const restDays = Math.max(1, parseInt(settings.pool_rest_days, 10) || 1)

  const numBatches = Math.max(1, Math.ceil(enabled.length / batchSize))
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000) / restDays)
  const activeBatchIdx = enabled.length ? dayIndex % numBatches : 0

  const activeIds = new Set(
    enabled.slice(activeBatchIdx * batchSize, activeBatchIdx * batchSize + batchSize).map((w) => w.id),
  )

  const hostnameOf = (u: string): string => {
    try {
      return new URL(u.includes('://') ? u : `https://${u}`).hostname
    } catch {
      return u
    }
  }

  const pool = all.map((w) => ({ ...w, active: activeIds.has(w.id), hostname: hostnameOf(w.url) }))
  // Requirement #1 (3rd batch): never hand out a config pointing at an
  // account we already know is unhealthy — 'unknown' (never checked) and
  // 'healthy' both still pass through.
  const activeHosts = pool.filter((w) => w.enabled && w.active && w.health_status !== 'unhealthy').map((w) => w.hostname)

  return { activeHosts, pool }
}
