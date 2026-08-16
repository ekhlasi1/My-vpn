import type { Env } from '../core/types'
import {
  getAllSettings,
  getUserByTelegramId,
  createUser,
  listUsers,
  deleteUser,
  addProRequest,
  upsertBotUser,
  listBotUsers,
  getPoolRotation,
  getQuotaStatus,
  setServicePaused,
} from '../db/queries'
import { buildUserSubscription } from '../services/subscription'
import { sendMessage, getChatMember, answerCallbackQuery } from './api'

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

async function buildBaseUrl(_env: Env, request: Request): Promise<URL> {
  // The public hostname the worker is served from is the same one the webhook was called on.
  return new URL(request.url)
}

// ---------- Bot menu buttons ----------
// A persistent reply-keyboard so users tap instead of typing slash commands.
// Button labels double as command aliases below (see `normalizeCommand`).
const BTN_TRIAL = '🎁 دریافت اشتراک تست'
const BTN_USAGE = '📊 وضعیت مصرف من'
const BTN_VIP = '🎖️ خرید اشتراک VIP'
const BTN_HELP = 'ℹ️ راهنما'
const CHECK_JOIN_CALLBACK = 'check_join'

function mainKeyboard(): Record<string, unknown> {
  return {
    reply_markup: {
      keyboard: [
        [BTN_TRIAL, BTN_USAGE],
        [BTN_VIP],
        [BTN_HELP],
      ],
      resize_keyboard: true,
      is_persistent: true,
    },
  }
}

/** Maps a menu-button tap to the equivalent slash command so one code path handles both. */
function normalizeCommand(text: string): string {
  switch (text) {
    case BTN_TRIAL:
      return '/start'
    case BTN_USAGE:
      return '/usage'
    case BTN_VIP:
      return '/pro'
    case BTN_HELP:
      return '/help'
    default:
      return text
  }
}

// ---------- Requirement #6: forced Telegram channel join ----------

const JOINED_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted'])

/**
 * Checks whether telegramId is a member of the configured required channel.
 * Returns true if the gate is disabled (no channel configured), if the user
 * is a member, OR if membership can't be verified (e.g. the bot hasn't been
 * added to the channel yet) — a misconfigured gate should never lock every
 * user out of the bot; the admin will see the error in the worker logs.
 */
async function isChannelMemberOrUnverifiable(
  token: string,
  requiredChannel: string,
  telegramId: string,
): Promise<boolean> {
  if (!requiredChannel) return true
  const result = await getChatMember(token, requiredChannel, telegramId)
  if (!result) return true // can't verify (bot not in channel / API error) — fail open
  return JOINED_STATUSES.has(result.status)
}

async function sendJoinPrompt(token: string, chatId: string, settings: Record<string, string>): Promise<void> {
  const channelUrl = settings.required_channel_url || 'https://t.me/donatewirepubg'
  await sendMessage(
    token,
    chatId,
    `⚠️ <b>برای استفاده از ربات ابتدا باید در کانال ما عضو شوید.</b>\n\nپس از عضویت، روی دکمه «✅ عضو شدم» بزنید.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 عضویت در کانال', url: channelUrl }],
          [{ text: '✅ عضو شدم، بررسی کن', callback_data: CHECK_JOIN_CALLBACK }],
        ],
      },
    },
  )
}

async function issueTrial(env: Env, telegramId: string, telegramName: string, baseUrl: URL, settings: Record<string, string>): Promise<string> {
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

  const [entry] = buildUserSubscription(
    { uuid, type: 'trial', status: 'active', telegram_name: telegramName, telegram_id: telegramId },
    baseUrl,
    { brandName: settings.brand_name, adminUsername: settings.telegram_admin_username },
  )

  return (
    `✅ <b>اشتراک تست شما فعال شد!</b>\n\n` +
    `⏳ مدت اعتبار: ${durationH} ساعت\n` +
    `📦 حجم: ${fmtMb(volumeMb)}\n\n` +
    `🔗 لینک اتصال شما (نام کانفیگ = مشخصات شما):\n<code>${entry?.link}</code>\n\n` +
    `برای مشاهده میزان مصرف: ${BTN_USAGE}`
  )
}

export async function handleTelegramUpdate(env: Env, request: Request, update: any): Promise<void> {
  const settings = await getAllSettings(env)
  const token = settings.telegram_bot_token
  if (!token) return

  const adminId = settings.telegram_admin_id
  const baseUrl = await buildBaseUrl(env, request)

  // ---------- "✅ عضو شدم" button taps ----------
  const callback = update?.callback_query
  if (callback && callback.data === CHECK_JOIN_CALLBACK) {
    const cbChatId: string = String(callback.message?.chat?.id ?? callback.from?.id ?? '')
    const cbTelegramId: string = String(callback.from?.id ?? cbChatId)
    const isMember = await isChannelMemberOrUnverifiable(token, settings.required_channel, cbTelegramId)
    if (isMember) {
      await answerCallbackQuery(token, callback.id, '✅ عضویت شما تایید شد')
      await sendMessage(token, cbChatId, '✅ عضویت شما تایید شد! از دکمه‌های زیر استفاده کنید:', mainKeyboard())
    } else {
      await answerCallbackQuery(token, callback.id, '❌ هنوز عضو کانال نشده‌اید.', true)
    }
    return
  }

  const message = update?.message
  if (!message) return

  const chatId: string = String(message.chat?.id ?? '')
  const telegramId: string = String(message.from?.id ?? chatId)
  const telegramName: string = message.from?.username
    ? `@${message.from.username}`
    : [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || telegramId
  const rawText: string = (message.text || '').trim()
  const text = normalizeCommand(rawText)
  const isAdmin = !!adminId && telegramId === adminId

  // Track every visitor on the site's admin dashboard, regardless of what
  // they end up doing.
  if (env.DB) {
    await upsertBotUser(env, telegramId, telegramName).catch((err) => console.error('upsertBotUser failed:', err))
  }

  // ---------- Requirement #6: gate everything behind the required channel ----------
  // Admins are exempt so the owner never gets locked out of their own bot.
  if (!isAdmin && settings.required_channel) {
    const isMember = await isChannelMemberOrUnverifiable(token, settings.required_channel, telegramId)
    if (!isMember) {
      await sendJoinPrompt(token, chatId, settings)
      return
    }
  }

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
    const { activeHosts } = await getPoolRotation(env)
    const entries = buildUserSubscription(
      { uuid, type: 'pro', status: 'active', telegram_name: targetId, telegram_id: targetId },
      baseUrl,
      { brandName: settings.brand_name, adminUsername: settings.telegram_admin_username, poolHosts: activeHosts },
    )
    const linksText = entries.map((e) => `${e.name}:\n<code>${e.link}</code>`).join('\n\n')
    await sendMessage(
      token,
      targetId,
      `🎖️ <b>اشتراک VIP شما فعال شد!</b>\n\n⏳ مدت: ${days} روز\n📦 حجم: ${fmtMb(volumeMb)}\n\n${linksText}`,
      mainKeyboard(),
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
    const botUsers = await listBotUsers(env, 5000)
    const active = users.filter((u) => u.status === 'active').length
    const pro = users.filter((u) => u.type === 'pro').length
    const quota = await getQuotaStatus(env)
    await sendMessage(
      token,
      chatId,
      `📊 <b>آمار</b>\n\nکل کاربران ربات: ${botUsers.length}\nکل اشتراک‌ها: ${users.length}\nفعال: ${active}\nپرو: ${pro}\n\n` +
        `🔌 مصرف امروز از سقف روزانه: ${quota.count} / ${quota.limit}\n⏸️ وضعیت سرویس: ${quota.paused ? 'متوقف' : 'فعال'}`,
    )
    return
  }

  if (isAdmin && text.startsWith('/pause')) {
    await setServicePaused(env, true)
    await sendMessage(token, chatId, '⏸️ همه اتصالات VPN موقتاً متوقف شدند.')
    return
  }

  if (isAdmin && text.startsWith('/resume')) {
    await setServicePaused(env, false)
    await sendMessage(token, chatId, '▶️ اتصالات VPN از سر گرفته شدند.')
    return
  }

  // ---------- Public commands ----------
  if (text === '/start' || text === '/trial') {
    const existing = await getUserByTelegramId(env, telegramId)
    if (existing && existing.status === 'active' && existing.type === 'trial') {
      const [entry] = buildUserSubscription(existing, baseUrl, { brandName: settings.brand_name, adminUsername: settings.telegram_admin_username })
      await sendMessage(
        token,
        chatId,
        `شما همین الان یک اشتراک تست فعال دارید ⏳ ${fmtRemaining(existing.expires_at)} مانده.\n\n🔗 لینک شما:\n<code>${entry?.link}</code>\n\nبرای مصرف: ${BTN_USAGE}`,
        mainKeyboard(),
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
          `⏰ شما اخیراً از تست استفاده کردید. تا دریافت تست بعدی ${remainH} ساعت دیگر صبر کنید.\n\nبرای اشتراک VIP نامحدود: ${BTN_VIP}`,
          mainKeyboard(),
        )
        return
      }
    }
    const msg = await issueTrial(env, telegramId, telegramName, baseUrl, settings)
    await sendMessage(token, chatId, msg, mainKeyboard())
    return
  }

  if (text === '/usage') {
    const user = await getUserByTelegramId(env, telegramId)
    if (!user) {
      await sendMessage(token, chatId, `شما هنوز اشتراکی دریافت نکرده‌اید. برای دریافت تست: ${BTN_TRIAL}`, mainKeyboard())
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
      mainKeyboard(),
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
      mainKeyboard(),
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
      `🤖 <b>دستورات ربات</b>\n\n` +
        `${BTN_TRIAL} — دریافت اشتراک تست\n` +
        `${BTN_USAGE} — مشاهده میزان مصرف\n` +
        `${BTN_VIP} — درخواست اشتراک VIP`,
      mainKeyboard(),
    )
    return
  }
}
