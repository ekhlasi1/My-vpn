// ==================== Simple worker-to-worker sync ====================
//
// Alternative to src/services/cf-accounts.ts (which needs a Cloudflare API
// Token + Account ID + D1 Database ID per remote account). This method only
// needs two things, both copy-pasteable from the OTHER worker's own
// dashboard ("🖧 پنل‌ها" tab):
//   - that worker's public URL
//   - that worker's own generated "رمز اتصال ورکر" (sync secret)
//
// This project's own worker exposes three small, unauthenticated-by-cookie
// endpoints (verified by the secret header instead) for this purpose — see
// the "Worker-sync" section in src/core/handler.ts:
//   POST /api/pool/ping        -> { ok: true }                (health check)
//   POST /api/pool/sync-user   -> upserts a user into local D1
//   POST /api/pool/remove-user -> deletes a user from local D1
//
// Nothing here ever touches the Cloudflare API — it's a plain HTTPS call
// from one worker to another, authenticated by a shared secret only the two
// admins involved know.

export interface WorkerSyncTarget {
  id: number
  url: string
  sync_secret: string
}

export interface HealthCheckResult {
  healthy: boolean
  error: string | null
  checked_at: number
}

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

function baseUrl(u: string): string {
  const withScheme = u.includes('://') ? u : `https://${u}`
  return withScheme.replace(/\/+$/, '')
}

async function call(
  target: WorkerSyncTarget,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; error: string | null }> {
  try {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Sync-Secret': target.sync_secret,
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    const res = await fetch(`${baseUrl(target.url)}${path}`, init)
    if (res.status === 401) {
      return { ok: false, status: 401, error: 'رمز اتصال ورکر اشتباه است' }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, error: `ورکر مقصد پاسخ ${res.status} داد ${text ? '(' + text.slice(0, 120) + ')' : ''}` }
    }
    return { ok: true, status: res.status, error: null }
  } catch {
    return { ok: false, status: 0, error: 'ورکر مقصد در دسترس نیست (خطای شبکه)' }
  }
}

/** Health check for the simple sync method: just proves the URL + secret pair actually works. */
export async function checkWorkerSyncHealth(target: WorkerSyncTarget): Promise<HealthCheckResult> {
  const now = Date.now()
  const result = await call(target, '/api/pool/ping')
  if (!result.ok) return { healthy: false, error: result.error, checked_at: now }
  return { healthy: true, error: null, checked_at: now }
}

/** Pushes one user upsert to the remote worker, which writes it into its own local D1. */
export async function syncUserToWorker(target: WorkerSyncTarget, user: SyncableUser): Promise<void> {
  const result = await call(target, '/api/pool/sync-user', { user })
  if (!result.ok) throw new Error(result.error ?? `HTTP ${result.status}`)
}

/** Removes a user from the remote worker's own local D1. */
export async function removeUserFromWorker(target: WorkerSyncTarget, uuid: string): Promise<void> {
  const result = await call(target, '/api/pool/remove-user', { uuid })
  if (!result.ok) throw new Error(result.error ?? `HTTP ${result.status}`)
}
