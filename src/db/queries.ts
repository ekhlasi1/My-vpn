import type { Env } from '../core/types'

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
}

export async function updateUser(env: Env, uuid: string, fields: Partial<UserRow>): Promise<void> {
  const keys = Object.keys(fields)
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  const values = keys.map((k) => (fields as Record<string, unknown>)[k])
  await env.DB.prepare(`UPDATE users SET ${sets} WHERE uuid = ?`)
    .bind(...values, uuid)
    .run()
}

export async function deleteUser(env: Env, uuid: string): Promise<void> {
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
}

export async function listPoolWorkers(env: Env): Promise<PoolWorkerRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM backend_pool ORDER BY id ASC').all<PoolWorkerRow>()
  return results ?? []
}

export async function addPoolWorker(env: Env, url: string, label: string | null): Promise<void> {
  await env.DB.prepare('INSERT INTO backend_pool (url, label, enabled, added_at) VALUES (?, ?, 1, ?)')
    .bind(url, label ?? null, Date.now())
    .run()
}

export async function removePoolWorker(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM backend_pool WHERE id = ?').bind(id).run()
}

export async function setPoolWorkerEnabled(env: Env, id: number, enabled: boolean): Promise<void> {
  await env.DB.prepare('UPDATE backend_pool SET enabled = ? WHERE id = ?').bind(enabled ? 1 : 0, id).run()
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
  const activeHosts = pool.filter((w) => w.enabled && w.active).map((w) => w.hostname)

  return { activeHosts, pool }
}
