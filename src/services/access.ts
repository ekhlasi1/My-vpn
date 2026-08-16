import type { Env } from '../core/types'
import { getUserByUuid, updateUser, addUsage } from '../db/queries'
import { splitAndFilter } from '../utils/array'

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

/** Records consumed traffic (in bytes) for a managed user. No-op for owner uuids. */
export async function recordUsageBytes(env: Env, auth: AuthResult, bytes: number): Promise<void> {
  if (!auth.ok || auth.kind !== 'managed' || bytes <= 0) return
  const mb = bytes / (1024 * 1024)
  try {
    await addUsage(env, auth.uuid, mb)
  } catch (err) {
    console.error('Failed to record usage:', err)
  }
}
