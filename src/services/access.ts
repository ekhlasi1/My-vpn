import type { Env } from '../core/types'
import { getUserByUuid, updateUser, addUsage, getSetting, setNotifiedStep } from '../db/queries'
import { splitAndFilter } from '../utils/array'
import { sendMessage } from '../telegram/api'

export type AuthResult =
  | { ok: true; kind: 'owner' }
  | { ok: true; kind: 'managed'; uuid: string }
  | { ok: false; reason: string }

/**
 * Checks whether a UUID is allowed to open a proxy connection.
 * Owner UUIDs (env.UUID) always pass and are not usage-limited.
 * Managed UUIDs (created via dashboard/bot) must exist, be active,
 * not be expired, and not be over their volume quota.
 */
export async function authorizeConnection(env: Env, uuid: string): Promise<AuthResult> {
  const ownerUuids = splitAndFilter(env.UUID || '', ',')
  if (ownerUuids.includes(uuid)) {
    return { ok: true, kind: 'owner' }
  }

  if (!env.DB) {
    return { ok: false, reason: 'unknown user' }
  }

  const user = await getUserByUuid(env, uuid)
  if (!user) return { ok: false, reason: 'unknown user' }
  if (user.status !== 'active') return { ok: false, reason: `user status: ${user.status}` }
  if (user.expires_at && user.expires_at < Date.now()) {
    await updateUser(env, uuid, { status: 'expired' })
    return { ok: false, reason: 'expired' }
  }
  if (user.volume_limit_mb > 0 && user.volume_used_mb >= user.volume_limit_mb) {
    await updateUser(env, uuid, { status: 'expired' })
    return { ok: false, reason: 'quota exceeded' }
  }

  return { ok: true, kind: 'managed', uuid }
}

function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} گیگابایت`
  return `${mb.toFixed(0)} مگابایت`
}

/**
 * Requirement #3: DM the user every time their cumulative usage crosses
 * another `usage_notify_step_mb` (default 400MB) threshold. Runs opportunistically
 * right after usage is recorded for a connection, so it's near-real-time without
 * needing a separate scheduled job.
 */
async function notifyUsageStepIfCrossed(env: Env, uuid: string): Promise<void> {
  if (!env.DB) return
  try {
    const [user, stepStr, token] = await Promise.all([
      getUserByUuid(env, uuid),
      getSetting(env, 'usage_notify_step_mb'),
      getSetting(env, 'telegram_bot_token'),
    ])
    if (!user || !token || !user.telegram_id) return
    const step = parseFloat(stepStr) || 400
    if (step <= 0) return

    const previousStep = user.notified_step_mb || 0
    const currentStepFloor = Math.floor(user.volume_used_mb / step) * step
    if (currentStepFloor <= previousStep) return // no new threshold crossed

    await setNotifiedStep(env, uuid, currentStepFloor)
    const remainingText =
      user.volume_limit_mb > 0
        ? `${fmtMb(user.volume_used_mb)} از ${fmtMb(user.volume_limit_mb)} مصرف شده`
        : `${fmtMb(user.volume_used_mb)} مصرف شده (نامحدود)`
    await sendMessage(
      token,
      user.telegram_id,
      `📶 <b>گزارش مصرف</b>\n\nشما به تازگی ${fmtMb(step)} دیگر مصرف کردید.\n${remainingText}\n\nبرای جزئیات بیشتر: /usage`,
    )
  } catch (err) {
    console.error('notifyUsageStepIfCrossed failed:', err)
  }
}

/** Records consumed traffic (in bytes) for a managed user. No-op for owner uuids. */
export async function recordUsageBytes(env: Env, auth: AuthResult, bytes: number): Promise<void> {
  if (!auth.ok || auth.kind !== 'managed' || bytes <= 0) return
  const mb = bytes / (1024 * 1024)
  try {
    await addUsage(env, auth.uuid, mb)
    await notifyUsageStepIfCrossed(env, auth.uuid)
  } catch (err) {
    console.error('Failed to record usage:', err)
  }
}

/** Cheap re-check used to cut an already-open tunnel the moment a mid-stream flush pushes it over quota. */
export async function isOverQuota(env: Env, auth: AuthResult): Promise<boolean> {
  if (!auth.ok || auth.kind !== 'managed') return false
  const user = await getUserByUuid(env, auth.uuid)
  if (!user) return false
  return user.volume_limit_mb > 0 && user.volume_used_mb >= user.volume_limit_mb
}
