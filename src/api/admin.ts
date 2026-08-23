import type { Env } from '../core/types'
import {
  getAllSettings,
  setSettings,
  hasAdminPassword,
  getSetting,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listBotUsers,
  getQuotaStatus,
  setServicePaused,
  addPoolWorker,
  removePoolWorker,
  setPoolWorkerEnabled,
  updatePoolWorker,
  checkAndStorePoolWorkerHealth,
  getPoolRotation,
  getOrCreateWorkerSyncSecret,
  regenerateWorkerSyncSecret,
} from '../db/queries'
import { hashPassword, verifyPassword } from '../auth/password'
import { createAdminSession, sessionCookieHeader, clearSessionCookieHeader, requireAdmin, logoutAdmin } from '../auth/session'
import { setWebhook, sendMessage, setMyCommands } from '../telegram/api'

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/admin/, '') || '/'
  const method = request.method

  // ---- Public (no session required) ----
  if (path === '/setup' && method === 'POST') {
    if (await hasAdminPassword(env)) return json({ error: 'قبلاً راه‌اندازی شده' }, 400)
    const { password } = await readJson(request)
    if (!password || password.length < 6) return json({ error: 'رمز باید حداقل ۶ کاراکتر باشد' }, 400)
    await setSettings(env, { admin_password_hash: await hashPassword(password) })
    const token = await createAdminSession(env)
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) })
  }

  if (path === '/login' && method === 'POST') {
    const { password } = await readJson(request)
    const hash = await getSetting(env, 'admin_password_hash')
    if (!hash || !(await verifyPassword(password || '', hash))) {
      return json({ error: 'رمز عبور اشتباه است' }, 401)
    }
    const token = await createAdminSession(env)
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) })
  }

  if (path === '/logout' && method === 'POST') {
    await logoutAdmin(request, env)
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() })
  }

  // ---- Everything below requires a valid session ----
  const authed = await requireAdmin(request, env)
  if (!authed) return json({ error: 'unauthorized' }, 401)

  if (path === '/stats' && method === 'GET') {
    const users = await listUsers(env, 5000)
    const active = users.filter((u) => u.status === 'active').length
    const pro = users.filter((u) => u.type === 'pro').length
    const trial = users.filter((u) => u.type === 'trial').length
    const inactive = users.length - active
    const totalUsageMb = users.reduce((sum, u) => sum + (u.volume_used_mb || 0), 0)
    return json({ total: users.length, active, pro, trial, inactive, totalUsageMb })
  }

  if (path === '/users' && method === 'GET') {
    const users = await listUsers(env, 1000)
    return json({ users })
  }

  // Requirement #1: every account that ever messaged the bot, listed on the site.
  if (path === '/bot-users' && method === 'GET') {
    const botUsers = await listBotUsers(env, 1000)
    return json({ botUsers })
  }

  if (path === '/users/pro' && method === 'POST') {
    const { telegramId, telegramName, days, volumeGb } = await readJson(request)
    if (!days || !volumeGb) return json({ error: 'مقادیر روز و حجم الزامی است' }, 400)
    const uuid = crypto.randomUUID()
    const now = Date.now()
    await createUser(env, {
      uuid,
      telegram_id: telegramId || null,
      telegram_name: telegramName || telegramId || null,
      type: 'pro',
      status: 'active',
      volume_limit_mb: Number(volumeGb) * 1024,
      volume_used_mb: 0,
      created_at: now,
      expires_at: now + Number(days) * 24 * 60 * 60 * 1000,
      warned_80: 0,
    })

    if (telegramId) {
      const token = await getSetting(env, 'telegram_bot_token')
      if (token) {
        // Requirement #3: send ONE auto-updating subscription link, not raw
        // pasted configs — see subscriptionUrl()'s twin in telegram/bot.ts.
        const subLink = `${url.origin}/${uuid}`
        await sendMessage(
          token,
          telegramId,
          `🎖️ <b>اشتراک VIP شما فعال شد!</b>\n\n⏳ مدت: ${days} روز\n📦 حجم: ${volumeGb} گیگابایت\n\n` +
            `🔗 لینک اشتراک شما (۵ کانفیگ داخل همین یک لینک — به‌عنوان subscription وارد اپلیکیشن کنید، هر ۱۲ ساعت خودکار بروزرسانی می‌شود):\n<code>${subLink}</code>`,
        )
      }
    }
    return json({ ok: true, uuid })
  }

  const userMatch = path.match(/^\/users\/([^/]+)(\/extend)?$/)
  if (userMatch && (method === 'PATCH' || method === 'DELETE' || (method === 'POST' && userMatch[2]))) {
    const uuid = decodeURIComponent(userMatch[1])
    if (method === 'DELETE') {
      await deleteUser(env, uuid)
      return json({ ok: true })
    }
    if (userMatch[2]) {
      const { days } = await readJson(request)
      const extendMs = (Number(days) || 30) * 24 * 60 * 60 * 1000
      const users = await listUsers(env, 1000)
      const user = users.find((u) => u.uuid === uuid)
      const base = user?.expires_at && user.expires_at > Date.now() ? user.expires_at : Date.now()
      await updateUser(env, uuid, { expires_at: base + extendMs, status: 'active' })
      return json({ ok: true })
    }
    const body = await readJson(request)
    const allowed: Record<string, unknown> = {}
    for (const k of ['status', 'note', 'volume_limit_mb']) {
      if (body[k] !== undefined) allowed[k] = body[k]
    }
    await updateUser(env, uuid, allowed)
    return json({ ok: true })
  }

  if (path === '/settings' && method === 'GET') {
    const settings = await getAllSettings(env)
    delete (settings as any).admin_password_hash
    return json(settings)
  }

  if (path === '/settings' && method === 'POST') {
    const body = await readJson(request)
    const allowedKeys = [
      'trial_duration_hours',
      'trial_volume_mb',
      'trial_cooldown_hours',
      'telegram_bot_token',
      'telegram_admin_id',
      'telegram_admin_username',
      'brand_name',
      'usage_notify_step_mb',
      'required_channel',
      'required_channel_url',
      'wiki_gift_link',
    ]
    const toSave: Record<string, string> = {}
    for (const k of allowedKeys) {
      if (body[k] !== undefined) toSave[k] = String(body[k])
    }
    await setSettings(env, toSave)
    return json({ ok: true })
  }

  // ---- Requirement #3: daily quota + kill switch ----
  if (path === '/quota' && method === 'GET') {
    const status = await getQuotaStatus(env)
    return json(status)
  }

  if (path === '/quota' && method === 'POST') {
    const { dailyLimit, autoPause } = await readJson(request)
    const toSave: Record<string, string> = {}
    if (dailyLimit !== undefined) toSave.daily_request_limit = String(Number(dailyLimit) || 90000)
    if (autoPause !== undefined) toSave.auto_pause_at_limit = autoPause ? '1' : '0'
    await setSettings(env, toSave)
    return json({ ok: true })
  }

  if (path === '/quota/pause' && method === 'POST') {
    await setServicePaused(env, true)
    return json({ ok: true })
  }

  if (path === '/quota/resume' && method === 'POST') {
    await setServicePaused(env, false)
    return json({ ok: true })
  }

  // ---- Requirement #4: backend worker pool ----
  if (path === '/pool' && method === 'GET') {
    const { pool } = await getPoolRotation(env)
    const settings = await getAllSettings(env)
    return json({ pool, batchSize: settings.pool_batch_size, restDays: settings.pool_rest_days })
  }

  if (path === '/pool' && method === 'POST') {
    const { url: workerUrl, label, syncSecret, cfAccountId, cfApiToken, cfDatabaseId, cfScriptName } = await readJson(request)
    if (!workerUrl) return json({ error: 'آدرس ورکر الزامی است' }, 400)
    await addPoolWorker(env, {
      url: String(workerUrl).trim(),
      label: label ? String(label) : null,
      sync_secret: syncSecret ? String(syncSecret).trim() : null,
      cf_account_id: cfAccountId ? String(cfAccountId).trim() : null,
      cf_api_token: cfApiToken ? String(cfApiToken).trim() : null,
      cf_database_id: cfDatabaseId ? String(cfDatabaseId).trim() : null,
      cf_script_name: cfScriptName ? String(cfScriptName).trim() : null,
    })
    return json({ ok: true })
  }

  // ---- Simple worker-to-worker sync: this worker's own secret (requirement: easier multi-account setup) ----
  if (path === '/sync-secret' && method === 'GET') {
    const secret = await getOrCreateWorkerSyncSecret(env)
    return json({ secret })
  }

  if (path === '/sync-secret/regenerate' && method === 'POST') {
    const secret = await regenerateWorkerSyncSecret(env)
    return json({ secret })
  }

  if (path === '/pool/settings' && method === 'POST') {
    const { batchSize, restDays } = await readJson(request)
    const toSave: Record<string, string> = {}
    if (batchSize !== undefined) toSave.pool_batch_size = String(Math.max(1, Number(batchSize) || 5))
    if (restDays !== undefined) toSave.pool_rest_days = String(Math.max(1, Number(restDays) || 1))
    await setSettings(env, toSave)
    return json({ ok: true })
  }

  const poolMatch = path.match(/^\/pool\/(\d+)$/)
  if (poolMatch && (method === 'PATCH' || method === 'DELETE')) {
    const id = Number(poolMatch[1])
    if (method === 'DELETE') {
      await removePoolWorker(env, id)
      return json({ ok: true })
    }
    const body = await readJson(request)
    if (body.enabled !== undefined && Object.keys(body).length === 1) {
      await setPoolWorkerEnabled(env, id, !!body.enabled)
      return json({ ok: true })
    }
    // Full edit of an account's stored fields (label + Cloudflare credentials).
    const allowed: Record<string, unknown> = {}
    if (body.url !== undefined) allowed.url = String(body.url).trim()
    if (body.label !== undefined) allowed.label = body.label ? String(body.label) : null
    if (body.syncSecret !== undefined) allowed.sync_secret = body.syncSecret ? String(body.syncSecret).trim() : null
    if (body.cfAccountId !== undefined) allowed.cf_account_id = body.cfAccountId ? String(body.cfAccountId).trim() : null
    if (body.cfApiToken !== undefined) allowed.cf_api_token = body.cfApiToken ? String(body.cfApiToken).trim() : null
    if (body.cfDatabaseId !== undefined) allowed.cf_database_id = body.cfDatabaseId ? String(body.cfDatabaseId).trim() : null
    if (body.cfScriptName !== undefined) allowed.cf_script_name = body.cfScriptName ? String(body.cfScriptName).trim() : null
    if (body.enabled !== undefined) allowed.enabled = body.enabled ? 1 : 0
    await updatePoolWorker(env, id, allowed as any)
    return json({ ok: true })
  }

  // ---- Requirement #1 (3rd batch): per-account Cloudflare health check ----
  if (path.match(/^\/pool\/(\d+)\/check$/) && method === 'POST') {
    const id = Number(path.match(/^\/pool\/(\d+)\/check$/)![1])
    const row = await checkAndStorePoolWorkerHealth(env, id)
    if (!row) return json({ error: 'اکانت پیدا نشد' }, 404)
    return json({ ok: true, account: row })
  }

  if (path === '/pool/check-all' && method === 'POST') {
    const { pool } = await getPoolRotation(env)
    const results = await Promise.all(pool.map((w) => checkAndStorePoolWorkerHealth(env, w.id)))
    return json({ ok: true, accounts: results.filter(Boolean) })
  }

  if (path === '/telegram/set-webhook' && method === 'POST') {
    const token = await getSetting(env, 'telegram_bot_token')
    if (!token) return json({ ok: false, error: 'ابتدا توکن ربات را ذخیره کنید' }, 400)
    const webhookUrl = `${url.origin}/api/tg/webhook`
    const result = await setWebhook(token, webhookUrl)
    // Requirement #5: register the ☰ command menu shown in Telegram clients.
    await setMyCommands(token, [
      { command: 'start', description: '🎁 دریافت اشتراک تست' },
      { command: 'usage', description: '📊 وضعیت مصرف من' },
      { command: 'pro', description: '🎖️ خرید اشتراک VIP' },
      { command: 'wikigift', description: '🎁 جایزه ماهانه ویژه VIP' },
      { command: 'help', description: 'ℹ️ راهنما' },
    ])
    return json({ ok: !!result?.ok, result })
  }

  if (path === '/change-password' && method === 'POST') {
    const { currentPassword, newPassword } = await readJson(request)
    const hash = await getSetting(env, 'admin_password_hash')
    if (!hash || !(await verifyPassword(currentPassword || '', hash))) {
      return json({ error: 'رمز فعلی اشتباه است' }, 401)
    }
    if (!newPassword || newPassword.length < 6) return json({ error: 'رمز جدید باید حداقل ۶ کاراکتر باشد' }, 400)
    await setSettings(env, { admin_password_hash: await hashPassword(newPassword) })
    return json({ ok: true })
  }

  return json({ error: 'not found' }, 404)
}
