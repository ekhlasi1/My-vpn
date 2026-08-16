import type { Env } from '../core/types'
import { getAllSettings, getUserByTelegramId, createUser, updateUser, addProRequest, listUsers, deleteUser } from '../db/queries'
import { generateSubscription } from '../services/subscription'
import { sendMessage } from './api'

function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} گیگابایت`
  return `${mb.toFixed(0)} مگابایت`
}

function fmtRemaining(expiresAt: number | null): string {
  if (!expiresAt) return 'نامحدود'
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'منقضی شده'
  const hours = Math.floor(ms / (1000 * 60 * 60))
  if (hours < 24) return `${hours} ساعت`
  return `${Math.floor(hours / 24)} روز`
}

async function buildBaseUrl(env: Env, request: Request): Promise<URL> {
  // The public hostname the worker is served from is the same one the webhook was called on.
  return new URL(request.url)
}

async function issueTrial(env: Env, telegramId: string, telegramName: string, baseUrl: URL): Promise<string> {
  const settings = await getAllSettings(env)
  const durationH = parseFloat(settings.trial_duration_hours) || 24
  const volumeMb = parseFloat(settings.trial_volume_mb) || 2048

  const uuid = crypto.randomUUID()
  const now = Date.now()
  await createUser(env, {
    uuid,
    telegram_id: telegramId,
    telegram_name: telegramName,
    type: 'trial',
    status: 'active',
    volume_limit_mb: volumeMb,
    volume_used_mb: 0,
    created_at: now,
    expires_at: now + durationH * 60 * 60 * 1000,
    last_trial_at: now,
    warned_80: 0,
  })

  const link = generateSubscription(uuid, baseUrl)
  return (
    `✅ <b>اشتراک تست شما فعال شد!</b>\n\n` +
    `⏳ مدت اعتبار: ${durationH} ساعت\n` +
    `📦 حجم: ${fmtMb(volumeMb)}\n\n` +
    `🔗 لینک اتصال شما:\n<code>${link}</code>\n\n` +
    `برای مشاهده میزان مصرف از دستور /usage استفاده کنید.`
  )
}

export async function handleTelegramUpdate(env: Env, request: Request, update: any): Promise<void> {
  const settings = await getAllSettings(env)
  const token = settings.telegram_bot_token
  if (!token) return

  const message = update?.message
  if (!message) return

  const chatId: string = String(message.chat?.id ?? '')
  const telegramId: string = String(message.from?.id ?? chatId)
  const telegramName: string = message.from?.username
    ? `@${message.from.username}`
    : [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || telegramId
  const text: string = (message.text || '').trim()
  const adminId = settings.telegram_admin_id
  const isAdmin = !!adminId && telegramId === adminId
  const baseUrl = await buildBaseUrl(env, request)

  // ---------- Admin-only commands ----------
  if (isAdmin && text.startsWith('/addpro')) {
    const parts = text.split(/\s+/).slice(1)
    const [targetId, daysStr, volumeGbStr] = parts
    if (!targetId || !daysStr || !volumeGbStr) {
      await sendMessage(token, chatId, 'فرمت درست: /addpro <telegram_id> <روز> <حجم به گیگابایت>')
      return
    }
    const days = parseFloat(daysStr)
    const volumeMb = parseFloat(volumeGbStr) * 1024
    const uuid = crypto.randomUUID()
    const now = Date.now()
    await createUser(env, {
      uuid,
      telegram_id: targetId,
      telegram_name: targetId,
      type: 'pro',
      status: 'active',
      volume_limit_mb: volumeMb,
      volume_used_mb: 0,
      created_at: now,
      expires_at: now + days * 24 * 60 * 60 * 1000,
      warned_80: 0,
    })
    const link = generateSubscription(uuid, baseUrl)
    await sendMessage(
      token,
      targetId,
      `🎖️ <b>اشتراک VIP شما فعال شد!</b>\n\n⏳ مدت: ${days} روز\n📦 حجم: ${fmtMb(volumeMb)}\n\n🔗 لینک اتصال:\n<code>${link}</code>`,
    )
    await sendMessage(token, chatId, `✅ اشتراک پرو برای ${targetId} ساخته شد.`)
    return
  }

  if (isAdmin && text.startsWith('/deluser')) {
    const uuid = text.split(/\s+/)[1]
    if (uuid) {
      await deleteUser(env, uuid)
      await sendMessage(token, chatId, `🗑️ کاربر ${uuid} حذف شد.`)
    }
    return
  }

  if (isAdmin && text.startsWith('/stats')) {
    const users = await listUsers(env, 5000)
    const active = users.filter((u) => u.status === 'active').length
    const pro = users.filter((u) => u.type === 'pro').length
    await sendMessage(
      token,
      chatId,
      `📊 <b>آمار</b>\n\nکل کاربران: ${users.length}\nفعال: ${active}\nپرو: ${pro}`,
    )
    return
  }

  // ---------- Public commands ----------
  if (text === '/start' || text === '/trial') {
    const existing = await getUserByTelegramId(env, telegramId)
    if (existing && existing.status === 'active' && existing.type === 'trial') {
      const link = generateSubscription(existing.uuid, baseUrl)
      await sendMessage(
        token,
        chatId,
        `شما همین الان یک اشتراک تست فعال دارید ⏳ ${fmtRemaining(existing.expires_at)} مانده.\n\n🔗 لینک شما:\n<code>${link}</code>\n\nبرای مصرف: /usage`,
      )
      return
    }
    if (existing && existing.last_trial_at) {
      const cooldownH = parseFloat(settings.trial_cooldown_hours) || 24
      const nextAllowed = existing.last_trial_at + cooldownH * 60 * 60 * 1000
      if (Date.now() < nextAllowed && existing.type === 'trial') {
        const remainH = Math.ceil((nextAllowed - Date.now()) / (1000 * 60 * 60))
        await sendMessage(
          token,
          chatId,
          `⏰ شما اخیراً از تست استفاده کردید. تا دریافت تست بعدی ${remainH} ساعت دیگر صبر کنید.\n\nبرای اشتراک VIP نامحدود: /pro`,
        )
        return
      }
    }
    const msg = await issueTrial(env, telegramId, telegramName, baseUrl)
    await sendMessage(token, chatId, msg)
    return
  }

  if (text === '/usage') {
    const user = await getUserByTelegramId(env, telegramId)
    if (!user) {
      await sendMessage(token, chatId, 'شما هنوز اشتراکی دریافت نکرده‌اید. برای دریافت تست: /start')
      return
    }
    const percent = user.volume_limit_mb > 0 ? Math.min(100, (user.volume_used_mb / user.volume_limit_mb) * 100) : 0
    const statusFa = user.status === 'active' ? '✅ فعال' : user.status === 'expired' ? '⛔ منقضی شده' : '🚫 غیرفعال'
    await sendMessage(
      token,
      chatId,
      `📊 <b>وضعیت اشتراک شما</b>\n\n` +
        `نوع: ${user.type === 'pro' ? '🎖️ VIP' : '🎁 تست'}\n` +
        `وضعیت: ${statusFa}\n` +
        `مصرف‌شده: ${fmtMb(user.volume_used_mb)}${user.volume_limit_mb > 0 ? ` از ${fmtMb(user.volume_limit_mb)} (${percent.toFixed(1)}٪)` : ' (نامحدود)'}\n` +
        `زمان باقیمانده: ${fmtRemaining(user.expires_at)}`,
    )
    return
  }

  if (text === '/pro' || text === '/vip') {
    await addProRequest(env, telegramId, telegramName)
    const adminUsername = settings.telegram_admin_username || 'vahidekhlasi'
    await sendMessage(
      token,
      chatId,
      `🎖️ برای فعال‌سازی اشتراک VIP لطفاً به ادمین پیام دهید:\n👤 @${adminUsername}`,
    )
    if (adminId) {
      await sendMessage(
        token,
        adminId,
        `🔔 درخواست اشتراک VIP جدید:\nکاربر: ${telegramName}\nآیدی: <code>${telegramId}</code>\n\nبرای ساخت: /addpro ${telegramId} <روز> <حجم گیگابایت>`,
      )
    }
    return
  }

  if (text === '/help') {
    await sendMessage(
      token,
      chatId,
      `🤖 <b>دستورات ربات</b>\n\n/start یا /trial — دریافت اشتراک تست\n/usage — مشاهده میزان مصرف\n/pro — درخواست اشتراک VIP`,
    )
    return
  }
}
