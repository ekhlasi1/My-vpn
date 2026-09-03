// ==================== Multi Cloudflare-account management (requirement #1, 3rd batch) ====================
//
// The dashboard's "پنل‌ها / اکانت‌های کلادفلر" tab lets the admin register an
// UNLIMITED number of *other* Cloudflare accounts (each running its own copy
// of this exact worker, deployed separately by the admin the normal way).
// For each one, the admin gives this project:
//   - the worker's public URL (used to serve config links + a liveness ping)
//   - (optional) a Cloudflare API Token scoped to that account, so we can
//     ask Cloudflare itself whether the account/token is healthy and the
//     worker script is actually deployed there
//   - (optional) that account's own D1 database id, so a VIP user created
//     here can be mirrored into that account's database too — which is what
//     makes the *same* subscription UUID valid when a config points at that
//     other account's worker (D1 cannot be shared cross-account, so this is
//     the only way one link can "belong" to several independent accounts).
//
// None of this ever sends a private key anywhere except straight to
// `api.cloudflare.com` over HTTPS, using the token the admin pasted in.

const CF_API = 'https://api.cloudflare.com/client/v4'

export interface CfAccountTarget {
  id: number
  url: string
  cf_account_id: string | null
  cf_api_token: string | null
  cf_database_id: string | null
  cf_script_name: string | null
}

export interface HealthCheckResult {
  healthy: boolean
  error: string | null
  checked_at: number
}

function hostnameOf(u: string): string {
  try {
    return new URL(u.includes('://') ? u : `https://${u}`).hostname
  } catch {
    return u
  }
}

// Same reasoning as SYNC_TIMEOUT_MS in worker-sync.ts: a hung remote call
// (here, to api.cloudflare.com) must never be able to stall the calling
// worker's own request indefinitely.
const CF_FETCH_TIMEOUT_MS = 8000

async function cfFetch(path: string, token: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CF_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    })
    const body = await res.json().catch(() => null)
    return { ok: res.ok && !!body?.success, status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Full health check for one registered account:
 *  1. If a URL is set, ping the worker itself over plain HTTPS — this alone
 *     proves the worker is deployed and Cloudflare is routing to it, and
 *     needs no API token at all (works for accounts the admin doesn't want
 *     to hand a token for, they just won't get config-generation/sync).
 *  2. If an API token is also set, verify the token is valid, then confirm
 *     the worker script still exists under that account (catches a token
 *     that's valid but for the wrong account, or a script that got deleted).
 * Any single failed step marks the account unhealthy with a human-readable
 * reason, shown next to it in the dashboard.
 */
export async function checkAccountHealth(account: CfAccountTarget): Promise<HealthCheckResult> {
  const now = Date.now()

  if (account.url) {
    try {
      const pingUrl = account.url.includes('://') ? account.url : `https://${account.url}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CF_FETCH_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(pingUrl, { method: 'GET', redirect: 'follow', signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      // Any HTTP response (even 401/403/404) proves the worker is alive and
      // routing — only a network-level failure (thrown exception) means down.
      if (res.status >= 500) {
        return { healthy: false, error: `ورکر پاسخ ${res.status} داد`, checked_at: now }
      }
    } catch (err) {
      return { healthy: false, error: 'ورکر در دسترس نیست (خطای شبکه)', checked_at: now }
    }
  }

  if (account.cf_api_token) {
    const verify = await cfFetch('/user/tokens/verify', account.cf_api_token).catch(() => null)
    if (!verify || !verify.ok) {
      return { healthy: false, error: 'توکن API نامعتبر یا منقضی است', checked_at: now }
    }

    if (account.cf_account_id && account.cf_script_name) {
      const script = await cfFetch(
        `/accounts/${account.cf_account_id}/workers/scripts/${encodeURIComponent(account.cf_script_name)}`,
        account.cf_api_token,
      ).catch(() => null)
      if (!script || !script.ok) {
        return { healthy: false, error: 'اسکریپت ورکر با این Account ID پیدا نشد', checked_at: now }
      }
    }
  }

  return { healthy: true, error: null, checked_at: now }
}

/** Runs a raw SQL statement against one account's own D1 database over the Cloudflare API. */
async function runRemoteD1(account: CfAccountTarget, sql: string, params: unknown[]): Promise<void> {
  if (!account.cf_api_token || !account.cf_account_id || !account.cf_database_id) {
    throw new Error('این اکانت اطلاعات D1 کامل ندارد (Account ID / API Token / Database ID)')
  }
  const result = await cfFetch(`/accounts/${account.cf_account_id}/d1/database/${account.cf_database_id}/query`, account.cf_api_token, {
    method: 'POST',
    body: JSON.stringify({ sql, params }),
  })
  if (!result.ok) {
    const msg = result.body?.errors?.[0]?.message || `HTTP ${result.status}`
    throw new Error(msg)
  }
}

/** Minimal shape needed to mirror a VIP/trial user into another account's D1. */
export interface SyncableUser {
  uuid: string
  telegram_id: string | null
  telegram_name: string | null
  type: string
  status: string
  volume_limit_mb: number
  volume_used_mb: number
  created_at: number
  expires_at: number | null
}

/**
 * Upserts one user row into a remote account's `users` table so the exact
 * same subscription UUID is valid on that account's worker too. Assumes
 * that account already has this project's schema applied (true for any
 * account that was deployed the normal way — schema.sql runs on every
 * build). Safe to call repeatedly; the upsert keeps it idempotent.
 */
export async function syncUserToAccount(account: CfAccountTarget, user: SyncableUser): Promise<void> {
  await runRemoteD1(
    account,
    `INSERT INTO users (uuid, telegram_id, telegram_name, type, status, volume_limit_mb, volume_used_mb, created_at, expires_at, warned_80, notified_step_mb)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
     ON CONFLICT(uuid) DO UPDATE SET
       telegram_id = excluded.telegram_id,
       telegram_name = excluded.telegram_name,
       type = excluded.type,
       status = excluded.status,
       volume_limit_mb = excluded.volume_limit_mb,
       expires_at = excluded.expires_at`,
    [
      user.uuid,
      user.telegram_id,
      user.telegram_name,
      user.type,
      user.status,
      user.volume_limit_mb,
      user.volume_used_mb,
      user.created_at,
      user.expires_at,
    ],
  )
}

/** Removes a user from a remote account's D1 (mirrors a delete/revoke here). */
export async function removeUserFromAccount(account: CfAccountTarget, uuid: string): Promise<void> {
  await runRemoteD1(account, `DELETE FROM users WHERE uuid = ?`, [uuid])
}

export { hostnameOf }
