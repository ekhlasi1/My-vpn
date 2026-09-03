import type { Env } from '../core/types'
import { syncUserToAccount, removeUserFromAccount, checkAccountHealth, hostnameOf, type CfAccountTarget, type SyncableUser } from '../services/cf-accounts'
import { syncUserToWorker, removeUserFromWorker, checkWorkerSyncHealth, fetchRemoteSubscriptionText, type WorkerSyncTarget } from '../services/worker-sync'
import { generateRandomToken } from '../auth/password'
import { discoverCleanIpsBatch, CANDIDATE_IPS, type CleanIpResult } from '../services/clean-ips'

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
  // ---- Editable display names for the configs shown to end users in their
  // subscription list. {brand}=brand_name, {admin}=telegram_admin_username,
  // {n}=server number (pro only, 1..PRO_CONFIG_COUNT). ----
  pro_config_name: '👑 {brand} VIP | سرور {n} | @{admin}',
  trial_config_name: '{brand} | خرید: @{admin}',
  // ---- Requirement #3: self-imposed daily request cap + kill switch ----
  // Cloudflare's Workers Free plan allows 100,000 requests/day; we default the
  // soft cap to 90,000 (90%) so the service pauses itself before Cloudflare
  // ever throttles/suspends the worker. Adjust from the dashboard if you're
  // on a paid plan with a higher ceiling.
  daily_request_limit: '90000',
  service_paused: '0',
  service_paused_reason: '',
  auto_pause_at_limit: '1',
  usage_quota_date: '',
  usage_quota_count: '0',
  // ---- Requirement #4: extra backend worker pool (rotation + rest) ----
  pool_batch_size: '5',
  pool_rest_days: '1',
  // ---- Requirement #5: automatic clean-IP discovery ----
  clean_ip_scan_offset: '0',
  // Off by default ("normal" mode): the scan tests each candidate IP from
  // inside the Worker itself (Cloudflare's own network), so it can only ever
  // measure Cloudflare-to-Cloudflare reachability — it has no way to know
  // whether an Iranian ISP can actually reach that IP. That produces exactly
  // the "shows healthy/low-latency but doesn't work for users" symptom. Until
  // there's a real outside-Iran-vantage-point check, leave this off so
  // configs keep using the worker's own domain as the connect address (the
  // behavior that worked before this feature existed). Admins who've
  // manually confirmed specific IPs work can still turn this on.
  auto_clean_ip_enabled: '0',
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
// avoid ever being throttled or suspended for going over that, we count
// EVERY request this Worker handles (not just proxy/WebSocket connections —
// see checkAndIncrementQuota's caller in core/handler.ts) in the `settings`
// table, and expose the running total + a manual pause/resume switch on the
// admin dashboard.
//
// Bug fixed here: the counter used to only increment on WebSocket upgrades
// (the proxy tunnel itself), while Cloudflare bills EVERY invocation of the
// Worker — subscription-page fetches, the admin dashboard, DoH/DNS-rules
// polling, the Telegram webhook, everything. That mismatch is why the
// in-dashboard counter could still read well under the configured cap while
// the real Cloudflare account had already been throttled: most real traffic
// was never being counted at all. It's now incremented once per request,
// unconditionally, at the very top of handleRequest.
//
// "Day" boundary: instead of UTC midnight, the quota resets at 00:03 UTC,
// which is 03:33 Iran time (Iran Standard Time is a fixed UTC+3:30, no DST
// since 2022) — matching the operator's own daily cutover time.
const QUOTA_RESET_UTC_MINUTES = 3 // 00:03 UTC == 03:33 Iran time (UTC+3:30)

/** The current "quota day" label (YYYY-MM-DD), where a day starts at 00:03 UTC / 03:33 Iran time, not UTC midnight. */
function currentQuotaDay(): string {
  const now = new Date()
  const shifted = new Date(now.getTime() - QUOTA_RESET_UTC_MINUTES * 60 * 1000)
  return shifted.toISOString().slice(0, 10) // YYYY-MM-DD
}

export interface QuotaStatus {
  date: string
  count: number
  limit: number
  paused: boolean
  /** 'auto' = paused automatically after hitting the daily cap (auto-lifts at the next 03:33 Iran time); 'manual' = the admin paused it themselves from the dashboard (stays paused until the admin resumes it, never auto-lifted). */
  pausedReason: 'auto' | 'manual' | null
  autoPause: boolean
}

/**
 * Reads quota status, auto-lifting an 'auto' pause (one caused by hitting
 * the daily cap, NOT one the admin set manually) once a new quota day has
 * started. A 'manual' pause never auto-lifts — only the admin's own
 * resume action clears it (requirement: "من اگه خواستم خودم وصل کنم یا قطع
 * کنم" — the admin's manual control always stays available and independent
 * of the automatic schedule).
 */
export async function getQuotaStatus(env: Env): Promise<QuotaStatus> {
  const settings = await getAllSettings(env)
  const today = currentQuotaDay()
  const sameDay = settings.usage_quota_date === today
  const count = sameDay ? parseFloat(settings.usage_quota_count) || 0 : 0
  const pausedReason = (settings.service_paused_reason as 'auto' | 'manual' | undefined) || null
  // A new quota day rolling over auto-clears only an 'auto' pause. If the
  // stored day is stale (sameDay is false) and it was an auto-pause, it's
  // effectively already lifted below by checkAndIncrementQuota on the next
  // request; report that here too so the dashboard reflects it immediately
  // even before another request comes in.
  const stillPaused = settings.service_paused === '1' && (pausedReason === 'manual' || sameDay)
  return {
    date: today,
    count,
    limit: parseFloat(settings.daily_request_limit) || 90000,
    paused: stillPaused,
    pausedReason: stillPaused ? pausedReason : null,
    autoPause: settings.auto_pause_at_limit !== '0',
  }
}

/**
 * Increments today's request counter (resetting it first if the quota day
 * rolled over at 03:33 Iran time) and, if auto-pause is enabled and the
 * counter just crossed the configured daily limit, flips the kill switch on
 * automatically (reason='auto'). An 'auto' pause from a previous day is
 * lifted automatically the moment the day rolls over; a 'manual' pause
 * (admin used the dashboard button) is left untouched regardless of the day
 * — only the admin's own resume clears it.
 * Returns whether the connection should be allowed to proceed.
 */
export async function checkAndIncrementQuota(env: Env): Promise<{ allowed: boolean; paused: boolean }> {
  const settings = await getAllSettings(env)
  const today = currentQuotaDay()
  const sameDay = settings.usage_quota_date === today
  const pausedReason = settings.service_paused_reason || null
  const currentlyPaused = settings.service_paused === '1'

  // Manual pause always wins, on any day, until the admin resumes it.
  if (currentlyPaused && pausedReason === 'manual') {
    return { allowed: false, paused: true }
  }

  const nextCount = (sameDay ? parseFloat(settings.usage_quota_count) || 0 : 0) + 1
  const limit = parseFloat(settings.daily_request_limit) || 90000
  const autoPause = settings.auto_pause_at_limit !== '0'
  const overLimit = limit > 0 && nextCount >= limit

  const toSave: Record<string, string> = { usage_quota_date: today, usage_quota_count: String(nextCount) }
  if (overLimit && autoPause) {
    toSave.service_paused = '1'
    toSave.service_paused_reason = 'auto'
  } else if (sameDay && currentlyPaused && pausedReason === 'auto' && !overLimit) {
    // Shouldn't normally happen (count only goes up within the same day),
    // but keep it consistent if the admin raised the limit mid-day.
    toSave.service_paused = '0'
    toSave.service_paused_reason = ''
  } else if (!sameDay && currentlyPaused && pausedReason === 'auto') {
    // New quota day (past 03:33 Iran time) — auto-lift yesterday's
    // auto-pause so configs reconnect on their own, per requirement #3.
    toSave.service_paused = '0'
    toSave.service_paused_reason = ''
  }
  await setSettings(env, toSave)

  const paused = toSave.service_paused === '1'
  return { allowed: !paused, paused }
}

/** Admin dashboard pause/resume — always 'manual', independent of the automatic daily-cap schedule. */
export async function setServicePaused(env: Env, paused: boolean): Promise<void> {
  await setSettings(env, {
    service_paused: paused ? '1' : '0',
    service_paused_reason: paused ? 'manual' : '',
  })
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
  const inserted = await env.DB.prepare(
    `INSERT INTO backend_pool
      (url, label, enabled, added_at, cf_account_id, cf_api_token, cf_database_id, cf_script_name, sync_secret, health_status)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'unknown')
     RETURNING *`,
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
    .first<PoolWorkerRow>()

  // ROOT-CAUSE FIX: a freshly-added account/worker starts with an EMPTY
  // users table. Previously, only users created/renewed/edited AFTER this
  // moment ever got mirrored to it (see syncUserToAllAccounts, called from
  // createUser/updateUser) — every already-existing trial/VIP user's uuid
  // was simply never written to this account's D1. The health check above
  // only pings the endpoint + secret, which succeeds fine, so the account
  // shows "healthy" — but the moment the pool rotation makes this account
  // "active" and hands its host out in a VIP user's subscription link, that
  // link fails at the VLESS layer with "invalid user" (TLS/WS still connect
  // fine, so it LOOKS like a working link right up until the tunnel itself
  // is opened). Backfilling every existing user here the moment the account
  // is added closes that gap. Never blocks/fails the account being added.
  if (inserted) {
    await backfillAllUsersToPoolWorker(env, inserted).catch((err) =>
      console.error(`addPoolWorker: initial backfill for account #${inserted.id} failed:`, err),
    )
  }
}

/**
 * Pushes EVERY existing user in this worker's own D1 to one pool
 * account/worker. Used both for the automatic backfill when an account is
 * first added (see addPoolWorker above) and for the manual "🔄 همگام‌سازی
 * مجدد همه کاربران" admin action (in case a row's credentials/secret were
 * only filled in later, or a previous backfill partially failed while the
 * remote worker was briefly unreachable). Safe to call repeatedly — every
 * write on the remote side is an upsert.
 */
export async function backfillAllUsersToPoolWorker(
  env: Env,
  row: PoolWorkerRow,
): Promise<{ synced: number; failed: number }> {
  if (!row.enabled || !(usesSimpleSync(row) || usesCfTokenSync(row))) return { synced: 0, failed: 0 }
  const users = await listUsers(env, 100000)
  let synced = 0
  let failed = 0
  for (const u of users) {
    try {
      const payload: SyncableUser = {
        uuid: u.uuid,
        telegram_id: u.telegram_id,
        telegram_name: u.telegram_name,
        type: u.type,
        status: u.status,
        volume_limit_mb: u.volume_limit_mb,
        volume_used_mb: u.volume_used_mb,
        created_at: u.created_at,
        expires_at: u.expires_at,
      }
      if (usesSimpleSync(row)) {
        await syncUserToWorker(toSyncTarget(row), payload)
      } else {
        await syncUserToAccount(toCfTarget(row), payload)
      }
      synced++
    } catch (err) {
      failed++
      console.error(`backfillAllUsersToPoolWorker: uuid ${u.uuid} -> account #${row.id} failed:`, err)
    }
  }
  await updatePoolWorker(env, row.id, { last_synced_at: Date.now() })
  return { synced, failed }
}

/**
 * Manual "sync everyone, everywhere, right now" admin action — runs
 * backfillAllUsersToPoolWorker() against every enabled, sync-configured pool
 * account. Useful after editing an account's credentials/secret, or just to
 * confirm every account is fully caught up.
 */
export async function resyncAllUsersToAllAccounts(
  env: Env,
): Promise<{ accountId: number; label: string | null; synced: number; failed: number }[]> {
  const accounts = await listPoolWorkers(env)
  const targets = accounts.filter((a) => a.enabled && (usesSimpleSync(a) || usesCfTokenSync(a)))
  const results = await Promise.all(
    targets.map(async (row) => {
      const { synced, failed } = await backfillAllUsersToPoolWorker(env, row)
      return { accountId: row.id, label: row.label, synced, failed }
    }),
  )
  return results
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

  const pool = all.map((w) => ({ ...w, active: activeIds.has(w.id), hostname: hostnameOf(w.url) }))
  // Requirement #1 (3rd batch): never hand out a config pointing at an
  // account we already know is unhealthy — 'unknown' (never checked) and
  // 'healthy' both still pass through.
  const activeHosts = pool.filter((w) => w.enabled && w.active && w.health_status !== 'unhealthy').map((w) => w.hostname)

  return { activeHosts, pool }
}

/** Shared minimal payload builder — one row shape both sync paths + extraction need. */
function toSyncableUser(u: Pick<UserRow, 'uuid' | 'telegram_id' | 'telegram_name' | 'type' | 'status' | 'volume_limit_mb' | 'volume_used_mb' | 'created_at' | 'expires_at'>): SyncableUser {
  return {
    uuid: u.uuid,
    telegram_id: u.telegram_id,
    telegram_name: u.telegram_name,
    type: u.type,
    status: u.status,
    volume_limit_mb: u.volume_limit_mb,
    volume_used_mb: u.volume_used_mb,
    created_at: u.created_at,
    expires_at: u.expires_at,
  }
}

/** Pushes the upsert for one user to one pool row, via whichever sync method it has configured. Throws if neither is configured or the call fails. */
async function presyncUserToRow(row: PoolWorkerRow, user: SyncableUser): Promise<void> {
  if (usesSimpleSync(row)) {
    await syncUserToWorker(toSyncTarget(row), user)
  } else if (usesCfTokenSync(row)) {
    await syncUserToAccount(toCfTarget(row), user)
  } else {
    throw new Error('این اکانت هنوز رمز اتصال ورکر یا اطلاعات توکن کلادفلر ندارد')
  }
}

/**
 * Manual "extract configs from another account's worker" action (dashboard
 * "پنل‌ها" tab — requirement: quick, reliable extraction using just that
 * worker's own URL + sync secret, which is exactly what's already stored on
 * a pool row). Re-syncs the given user to that ONE account right now (so the
 * uuid is guaranteed present regardless of any past sync gap), then fetches
 * that worker's own real subscription output for it — the same live-extract
 * primitive used automatically for every VIP config, see
 * getLivePoolConfigOverrides below.
 */
export async function extractConfigFromPoolWorker(
  env: Env,
  poolId: number,
  uuid: string,
): Promise<{ links: string[]; hostname: string }> {
  const row = await getPoolWorker(env, poolId)
  if (!row) throw new Error('اکانت پیدا نشد')
  const user = await getUserByUuid(env, uuid)
  if (!user) throw new Error('کاربری با این UUID پیدا نشد')
  await presyncUserToRow(row, toSyncableUser(user))
  const links = await fetchRemoteSubscriptionText(row.url, uuid)
  await updatePoolWorker(env, row.id, { last_synced_at: Date.now() })
  return { links, hostname: hostnameOf(row.url) }
}

/**
 * Automatic version of the same extraction, run on every VIP subscription
 * fetch for every currently-active pool host (requirements #1/#2): this is
 * the actual root-cause fix for "configs pointing at another account's
 * worker don't work" — instead of the main account guessing that a past
 * sync succeeded and just gluing the other worker's hostname into a locally
 * built link, it re-syncs the user AND pulls back that worker's own live,
 * real subscription line right now, every time. A slot whose host isn't in
 * the returned map (extraction failed/timed out for that one host) simply
 * falls back to the old local-construction behavior in buildUserSubscription
 * — this only ever makes things MORE likely to work, never less.
 *
 * Runs all hosts in parallel (not sequential) so total added latency on the
 * subscription page is bounded by the slowest single remote account, not
 * their sum; each individual call already has its own hard timeout (see
 * SYNC_TIMEOUT_MS in worker-sync.ts).
 */
export async function getLivePoolConfigOverrides(
  activePool: (PoolWorkerRow & { active: boolean; hostname: string })[],
  user: Pick<UserRow, 'uuid' | 'telegram_id' | 'telegram_name' | 'type' | 'status' | 'volume_limit_mb' | 'volume_used_mb' | 'created_at' | 'expires_at'>,
): Promise<Record<string, string>> {
  const targets = activePool.filter((w) => w.enabled && w.active && (usesSimpleSync(w) || usesCfTokenSync(w)))
  if (!targets.length) return {}
  const payload = toSyncableUser(user)
  const overrides: Record<string, string> = {}
  await Promise.all(
    targets.map(async (row) => {
      try {
        await presyncUserToRow(row, payload)
        const links = await fetchRemoteSubscriptionText(row.url, user.uuid)
        if (links[0]) overrides[row.hostname] = links[0]
      } catch (err) {
        console.error(`live pool extraction for ${row.hostname} (#${row.id}) failed:`, err)
      }
    }),
  )
  return overrides
}

// ==================== Clean-IP discovery (requirement #5) ====================

export interface CleanIpRow {
  ip: string
  latency_ms: number | null
  healthy: number
  last_checked: number
  last_error: string | null
  colo: string | null
  country: string | null
  approved: number
}

/**
 * Persists the results of one discoverCleanIpsBatch() run. Deliberately
 * does NOT touch `approved` on conflict — re-testing an IP (or finding it
 * now maps to a different colo) never silently un-approves or approves it;
 * that stays entirely under the admin's manual control (see
 * setCleanIpsApproved below).
 */
async function saveCleanIpResults(env: Env, results: CleanIpResult[]): Promise<void> {
  for (const r of results) {
    await env.DB.prepare(
      `INSERT INTO clean_ips (ip, latency_ms, healthy, last_checked, last_error, colo, country)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         latency_ms = excluded.latency_ms,
         healthy = excluded.healthy,
         last_checked = excluded.last_checked,
         last_error = excluded.last_error,
         colo = excluded.colo,
         country = excluded.country`,
    )
      .bind(r.ip, r.latencyMs, r.healthy ? 1 : 0, Date.now(), r.error, r.colo, r.country)
      .run()
  }
}

/**
 * Admin-only, explicit approval step (requirement: "با تأیید نهایی من به
 * لیست ربات اضافه بشه" — only add to the bot's list with my final
 * confirmation). Marks the given IPs approved/unapproved; only
 * approved AND currently-healthy IPs are ever eligible in getBestCleanIp.
 */
export async function setCleanIpsApproved(env: Env, ips: string[], approved: boolean): Promise<void> {
  for (const ip of ips) {
    await env.DB.prepare(`UPDATE clean_ips SET approved = ? WHERE ip = ?`)
      .bind(approved ? 1 : 0, ip)
      .run()
  }
}

/**
 * Tests the next rotating batch of candidate IPs (see clean-ips.ts) against
 * this worker's own domain, saves the results, and advances the rotation
 * offset so the next run picks up where this one left off — the full
 * candidate list gets cycled through gradually across maintenance runs
 * instead of hammering ~35 subrequests every single time.
 */
export async function runCleanIpDiscovery(env: Env, domain: string, batchSize?: number): Promise<CleanIpResult[]> {
  const offsetStr = await getSetting(env, 'clean_ip_scan_offset')
  const offset = parseInt(offsetStr, 10) || 0
  const results = await discoverCleanIpsBatch(domain, offset, batchSize)
  await saveCleanIpResults(env, results)
  await setSetting(env, 'clean_ip_scan_offset', String((offset + results.length) % CANDIDATE_IPS.length))
  return results
}

/** All tested IPs, healthiest + fastest first (for the dashboard). */
export async function listCleanIps(env: Env, limit = 50): Promise<CleanIpRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM clean_ips ORDER BY healthy DESC, latency_ms ASC LIMIT ?`,
  )
    .bind(limit)
    .all<CleanIpRow>()
  return results ?? []
}

/**
 * How fresh a clean_ips row has to be to be trusted. Without this, an IP
 * that tested healthy hours ago (before getting blocked since) could keep
 * being handed out as "the" clean IP until its next scheduled re-test —
 * which is exactly the "sometimes it doesn't ping" symptom. Paired with
 * maybeRunCleanIpScan's much shorter cycle (see handler.ts), a stale row
 * simply stops qualifying instead of silently going bad.
 */
const CLEAN_IP_FRESHNESS_MS = 90 * 60 * 1000 // 90 minutes

/**
 * A currently-healthy, recently-verified IP, chosen randomly from among the
 * fastest few candidates rather than always the single lowest-latency one.
 * Handing every user the exact same "best" IP concentrates all traffic (and
 * all blocking risk) onto one address; spreading them across the top
 * candidates means a fresh block on one doesn't take down every user's
 * config at once, while still keeping selection biased toward the fastest
 * options. Returns null if none has been discovered yet (fresh deploy),
 * none currently qualifies, or none has been admin-approved yet — callers
 * must treat null as "no override", i.e. configs fall back to the worker's
 * own domain as the connect address exactly like before this feature
 * existed.
 *
 * Being "healthy" alone is NOT enough for an IP to be returned here — it
 * must also have `approved = 1`, set only via setCleanIpsApproved() from
 * the admin dashboard. Auto-discovery finds and tests candidates and shows
 * them (with colo/country) in the dashboard; it never approves them itself.
 */
export async function getBestCleanIp(env: Env): Promise<string | null> {
  // Gate behind auto_clean_ip_enabled (default '0'/off) — see the setting's
  // comment above. When off, every caller gets null and falls back to the
  // worker's own domain as the connect address, i.e. "normal" mode.
  const enabled = await getSetting(env, 'auto_clean_ip_enabled')
  if (enabled !== '1') return null

  const { results } = await env.DB.prepare(
    `SELECT ip FROM clean_ips WHERE healthy = 1 AND approved = 1 AND last_checked > ? ORDER BY latency_ms ASC LIMIT 5`,
  )
    .bind(Date.now() - CLEAN_IP_FRESHNESS_MS)
    .all<{ ip: string }>()
  if (!results || results.length === 0) return null
  return results[Math.floor(Math.random() * results.length)].ip
}

/** One clean-IP candidate as handed to a config-name builder (ip + its detected colo, for the flag). */
export interface CleanIpPick {
  ip: string
  colo: string | null
}

/**
 * Top `limit` currently-healthy, recently-verified IPs regardless of admin
 * approval — the "2 automatic" configs (requirement #1): these are added to
 * every managed user's config list unconditionally (as long as the
 * auto_clean_ip_enabled toggle is on), the same way the feature behaved
 * before the approval step existed. Ordered fastest-first. Returns fewer
 * than `limit` (down to an empty array) if not enough healthy IPs have been
 * discovered yet — callers must treat a short/empty array as "use the plain
 * worker host for the remaining slots".
 */
export async function getAutoCleanIps(env: Env, limit = 2): Promise<CleanIpPick[]> {
  const enabled = await getSetting(env, 'auto_clean_ip_enabled')
  if (enabled !== '1') return []
  const { results } = await env.DB.prepare(
    `SELECT ip, colo FROM clean_ips WHERE healthy = 1 AND last_checked > ? ORDER BY latency_ms ASC LIMIT ?`,
  )
    .bind(Date.now() - CLEAN_IP_FRESHNESS_MS, limit)
    .all<CleanIpPick>()
  return results ?? []
}

/**
 * Up to `limit` admin-approved (tested + hand-picked from the dashboard) IPs
 * — the "3 configs that I pick and test" (requirement #1). Ordered
 * fastest-first among the admin's own selection. Returns fewer than `limit`
 * (down to an empty array) if the admin hasn't approved that many — callers
 * must treat a short/empty array as "use the plain worker host for the
 * remaining slots", i.e. exactly the old pre-clean-IP behaviour when nothing
 * has been picked yet.
 */
export async function getApprovedCleanIps(env: Env, limit = 3): Promise<CleanIpPick[]> {
  const enabled = await getSetting(env, 'auto_clean_ip_enabled')
  if (enabled !== '1') return []
  const { results } = await env.DB.prepare(
    `SELECT ip, colo FROM clean_ips WHERE healthy = 1 AND approved = 1 AND last_checked > ? ORDER BY latency_ms ASC LIMIT ?`,
  )
    .bind(Date.now() - CLEAN_IP_FRESHNESS_MS, limit)
    .all<CleanIpPick>()
  return results ?? []
}

// ==================== Public DNS routing list (Private DNS / DoT feature) ====================
//
// See migration-v7.sql + docs/private-dns-fa.md. This is the domain/ip/cidr
// list the standalone DoT server (dot-server/, deployed outside this Worker
// since Workers can't host a raw TLS listener on port 853) fetches from the
// public GET /api/dns-rules endpoint. It is intentionally unauthenticated on
// read — the whole point (per the request that added it) is that it's a
// shared, public routing list anyone's Private DNS client can consult, not a
// per-user setting. Writes still go through the authenticated admin API.

export interface DnsRuleRow {
  id: number
  kind: 'domain' | 'ip' | 'cidr'
  value: string
  note: string | null
  created_at: number
}

/** All configured rules, newest first — used by both the admin dashboard and the public API. */
export async function listDnsRules(env: Env): Promise<DnsRuleRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM dns_rules ORDER BY created_at DESC`,
  ).all<DnsRuleRow>()
  return results ?? []
}

/**
 * Adds one rule. `kind` must be 'domain' (exact host or a `*.` wildcard),
 * 'ip' (single address), or 'cidr' (address/prefix range) — the dot-server
 * treats 'ip' as a /32 (or /128) cidr, so both share one matcher there.
 * Duplicate (kind, value) pairs are ignored rather than erroring, so the
 * admin UI can "add" the same rule twice without showing a failure.
 */
export async function addDnsRule(env: Env, kind: 'domain' | 'ip' | 'cidr', value: string, note?: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO dns_rules (kind, value, note, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(kind, value.trim(), note || null, Date.now())
    .run()
}

export async function deleteDnsRule(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM dns_rules WHERE id = ?`).bind(id).run()
}
