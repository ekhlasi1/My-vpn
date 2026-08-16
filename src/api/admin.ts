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
  getUserByTelegramId,
} from '../db/queries'
import { hashPassword, verifyPassword } from '../auth/password'
import { createAdminSession, sessionCookieHeader, clearSessionCookieHeader, requireAdmin, logoutAdmin } from '../auth/session'
import { setWebhook, sendMessage } from '../telegram/api'
import { generateSubscription } from '../services/subscription'

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
        const link = generateSubscription(uuid, url)
        await sendMessage(
          token,
          telegramId,
          `🎖️ <b>اشتراک VIP شما فعال شد!</b>\n\n⏳ مدت: ${days} روز\n📦 حجم: ${volumeGb} گیگابایت\n\n🔗 لینک اتصال:\n<code>${link}</code>`,
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
    ]
    const toSave: Record<string, string> = {}
    for (const k of allowedKeys) {
      if (body[k] !== undefined) toSave[k] = String(body[k])
    }
    await setSettings(env, toSave)
    return json({ ok: true })
  }

  if (path === '/telegram/set-webhook' && method === 'POST') {
    const token = await getSetting(env, 'telegram_bot_token')
    if (!token) return json({ ok: false, error: 'ابتدا توکن ربات را ذخیره کنید' }, 400)
    const webhookUrl = `${url.origin}/api/tg/webhook`
    const result = await setWebhook(token, webhookUrl)
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
