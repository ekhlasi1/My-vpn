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
