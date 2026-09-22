import type { Env } from '../core/types'
import { getUserByUuid, updateUser, addUsage, getSetting, setNotifiedStep } from '../db/queries'
import { splitAndFilter } from '../utils/array'
import { sendMessage } from '../telegram/api'

export type AuthResult =
  | { ok: true; kind: 'owner' }
  | { ok: true; kind: 'managed'; uuid: string }
  | { ok: false; reason: string }

/**
 * Resolves the pool of relay addresses (`host:port`) used as a fallback
 * when `connect()` can't reach a destination directly — which is expected
 * for most sites fronted by Cloudflare, since Workers can't open outbound
 * sockets straight into Cloudflare's own IP ranges (see
 * docs/troubleshooting.md / docs/environment-variables.md). Previously this
 * was ONLY `env.PROXY_IP`, a value baked into wrangler.toml at deploy time.
 * That's a problem in practice: the three example IPs shipped in
 * wrangler.toml are copy-pasted across countless public VLESS-worker
 * tutorials, so they're constantly overloaded/blocked, and updating them
 * meant editing wrangler.toml and redeploying. The panel already runs a
 * scanner (Radar / manual scan / Vahid scan) that finds IPs which are
 * currently reachable — but until now its results only ever fed the
 * client-facing "clean IP" list, never this relay pool, so a fresh scan
 * couldn't actually fix "sites behind Cloudflare won't open".
 *
 * `proxy_ip_pool` (a D1 setting, editable from the panel without a
 * redeploy) now takes priority when set; `env.PROXY_IP` is the fallback if
 * the setting is empty. Cached briefly per isolate for the same reason
 * authorizeConnection is cached — this is read on every new stream.
 */
const PROXY_POOL_CACHE_TTL_MS = 30_000
let proxyPoolCache: { pool: string[]; expiresAt: number } | null = null

export async function resolveProxyIpPool(env: Env): Promise<string[]> {
  if (proxyPoolCache && proxyPoolCache.expiresAt > Date.now()) {
    return proxyPoolCache.pool
  }

  let pool: string[] = []
  if (env.DB) {
    try {
      const fromPanel = await getSetting(env, 'proxy_ip_pool')
      pool = splitAndFilter(fromPanel || '', ',')
    } catch (err) {
      console.error('resolveProxyIpPool: failed to read proxy_ip_pool setting:', err)
    }
  }
  if (pool.length === 0) {
    pool = splitAndFilter(env.PROXY_IP || '', ',')
  }

  proxyPoolCache = { pool, expiresAt: Date.now() + PROXY_POOL_CACHE_TTL_MS }
  return pool
}

/**
 * Per-isolate cache for authorizeConnection results.
 *
 * VLESS-over-WS is one WebSocket per TCP stream, so a single page load can
 * open dozens of new connections in a couple of seconds. Without a cache,
 * every one of those paid a full D1 round trip (`getUserByUuid`) before the
 * proxy socket was even dialed — that's on top of the actual TCP dial to
 * the destination, and is the kind of added-latency-per-connection that
 * shows up as "everything feels slow / connects and drops" versus a config
 * that only checks a static UUID list. A short TTL keeps this cheap while
 * still picking up status/expiry/quota changes within a few seconds
 * (the worker process isn't guaranteed to stay warm, so this is a bonus
 * optimization, not something to rely on for strict real-time cutoff —
 * `isOverQuota` still does a fresh, uncached read mid-stream for that).
 */
const AUTH_CACHE_TTL_MS = 15_000
const authCache = new Map<string, { result: AuthResult; expiresAt: number }>()

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

  const cached = authCache.get(uuid)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  const result = await authorizeManagedUuid(env, uuid)
  authCache.set(uuid, { result, expiresAt: Date.now() + AUTH_CACHE_TTL_MS })
  return result
}

async function authorizeManagedUuid(env: Env, uuid: string): Promise<AuthResult> {
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
