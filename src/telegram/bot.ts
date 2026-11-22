import type { Env } from '../core/types'
import {
  getAllSettings,
  getUserByTelegramIdAndType,
  getUsersByTelegramId,
  createUser,
  updateUser,
  listUsers,
  deleteUser,
  addProRequest,
  upsertBotUser,
  listBotUsers,
  getQuotaStatus,
  setServicePaused,
} from '../db/queries'
import type { UserRow } from '../db/queries'
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

/** The `/<uuid>` link — a subscription URL, not raw configs. Every VLESS/V2Ray
 * client that supports "subscriptions" re-fetches this on its own schedule
 * (we hint 12h via the Profile-Update-Interval header, see core/handler.ts),
 * so pool-rotation changes, new servers, etc. reach the user automatically
 * without them re-importing anything (requirement: 12h auto-updating link). */
function subscriptionUrl(baseUrl: URL, uuid: string): string {
  return `${baseUrl.origin}/${uuid}`
}

// ---------- Bot menu buttons ----------
// A persistent reply-keyboard so users tap instead of typing slash commands.
// Button labels double as command aliases below (see `normalizeCommand`).
const BTN_TRIAL = '🎁 دریافت اشتراک تست'
const BTN_USAGE = '📊 وضعیت مصرف من'
const BTN_VIP = '🎖️ خرید اشتراک VIP'
const BTN_WIKI_GIFT = '🎁 جایزه ویژه VIP'
const BTN_HELP = 'ℹ️ راهنما'
const CHECK_JOIN_CALLBACK = 'check_join'

function mainKeyboard(): Record<string, unknown> {
  return {
    reply_markup: {
      keyboard: [
        [BTN_TRIAL, BTN_USAGE],
        [BTN_VIP, BTN_WIKI_GIFT],
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
    case BTN_WIKI_GIFT:
      return '/wikigift'
    case BTN_HELP:
      return '/help'
    default:
      return text
  }
}

// ---------- Requirement #6 (1st batch): forced Telegram channel join ----------

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

  return (
    `✅ <b>اشتراک تست شما فعال شد!</b>\n\n` +
    `⏳ مدت اعتبار: ${durationH} ساعت\n` +
    `📦 حجم: ${fmtMb(volumeMb)}\n\n` +
    `🔗 لینک اشتراک شما (این لینک را به‌عنوان subscription در اپلیکیشن وارد کنید — خودش بروزرسانی می‌شود):\n<code>${subscriptionUrl(baseUrl, uuid)}</code>\n\n` +
    `برای مشاهده میزان مصرف: ${BTN_USAGE}`
  )
}

/**
 * Requirement #1: trial usage and VIP usage must always be shown as two
 * separate figures, never merged.
 * Requirement #2 (3rd batch): as long as the subscription is still active,
 * the user's subscription link must be viewable/retrievable from inside
 * their own account in the bot — not just at the moment it was first
 * issued. Once it expires (or is disabled), the link is dropped from this
 * block entirely so an old screenshot/message never implies continued access.
 */
function formatUsageBlock(user: UserRow, baseUrl: URL): string {
  const percent = user.volume_limit_mb > 0 ? Math.min(100, (user.volume_used_mb / user.volume_limit_mb) * 100) : 0
  const statusFa = user.status === 'active' ? '✅ فعال' : user.status === 'expired' ? '⛔ منقضی شده' : '🚫 غیرفعال'
  const title = user.type === 'pro' ? '🎖️ اشتراک VIP' : '🎁 اشتراک تست'
  const linkLine = user.status === 'active' ? `\n🔗 لینک اشتراک:\n<code>${subscriptionUrl(baseUrl, user.uuid)}</code>` : ''
  return (
    `<b>${title}</b>\n` +
    `وضعیت: ${statusFa}\n` +
    `مصرف‌شده: ${fmtMb(user.volume_used_mb)}${user.volume_limit_mb > 0 ? ` از ${fmtMb(user.volume_limit_mb)} (${percent.toFixed(1)}٪)` : ' (نامحدود)'}\n` +
    `زمان باقیمانده: ${fmtRemaining(user.expires_at)}` +
    linkLine
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

  // ---------- gate everything behind the required channel ----------
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
    // Requirement #3: give the user ONE subscription link (not 5 pasted raw
    // configs) — every subscription-aware client re-fetches it automatically
    // (Profile-Update-Interval: 12, set in core/handler.ts), which is also
    // how pool-rotation changes (requirement #4) reach them without
    // re-sending anything.
    await sendMessage(
      token,
      targetId,
      `🎖️ <b>اشتراک VIP شما فعال شد!</b>\n\n⏳ مدت: ${days} روز\n📦 حجم: ${fmtMb(volumeMb)}\n\n` +
        `🔗 لینک اشتراک شما (۵ کانفیگ داخل همین یک لینک — به‌عنوان subscription وارد اپلیکیشن کنید، هر ۱۲ ساعت خودکار بروزرسانی می‌شود):\n<code>${subscriptionUrl(baseUrl, uuid)}</code>`,
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
    // Requirement #1: look up the TRIAL subscription specifically — not
    // "whichever subscription (trial or pro) this person created most
    // recently" — so a VIP purchase never hides/confuses their trial
    // cooldown, and vice versa.
    const existingTrial = await getUserByTelegramIdAndType(env, telegramId, 'trial')
    if (existingTrial && existingTrial.status === 'active') {
      await sendMessage(
        token,
        chatId,
        `شما همین الان یک اشتراک تست فعال دارید ⏳ ${fmtRemaining(existingTrial.expires_at)} مانده.\n\n🔗 لینک اشتراک شما:\n<code>${subscriptionUrl(baseUrl, existingTrial.uuid)}</code>\n\nبرای مصرف: ${BTN_USAGE}`,
        mainKeyboard(),
      )
      return
    }
    if (existingTrial && existingTrial.last_trial_at) {
      const cooldownH = parseFloat(settings.trial_cooldown_hours) || 24
      const nextAllowed = existingTrial.last_trial_at + cooldownH * 60 * 60 * 1000
      if (Date.now() < nextAllowed) {
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
    // Requirement #1: show trial usage and VIP usage as two separate blocks
    // instead of just whichever subscription happens to be newest.
    const rows = await getUsersByTelegramId(env, telegramId)
    if (!rows.length) {
      await sendMessage(token, chatId, `شما هنوز اشتراکی دریافت نکرده‌اید. برای دریافت تست: ${BTN_TRIAL}`, mainKeyboard())
      return
    }
    const trial = rows.find((u) => u.type === 'trial')
    const pro = rows.find((u) => u.type === 'pro')
    const blocks = [trial, pro].filter((u): u is UserRow => !!u).map((u) => formatUsageBlock(u, baseUrl))
    await sendMessage(token, chatId, `📊 <b>وضعیت اشتراک‌های شما</b>\n\n${blocks.join('\n\n')}`, mainKeyboard())
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

  // ---------- Requirement #6 (2nd batch): monthly "Wiki" bonus config for VIP users ----------
  if (text === '/wikigift') {
    const pro = await getUserByTelegramIdAndType(env, telegramId, 'pro')
    if (!pro || pro.status !== 'active') {
      await sendMessage(
        token,
        chatId,
        `🎖️ این جایزه فقط برای کاربران VIP فعال است.\n\nبرای خرید اشتراک VIP: ${BTN_VIP}`,
        mainKeyboard(),
      )
      return
    }
    const giftLink = settings.wiki_gift_link
    if (!giftLink) {
      await sendMessage(token, chatId, '🎁 این جایزه هنوز توسط مدیر تنظیم نشده است.', mainKeyboard())
      return
    }
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000
    const last = pro.wiki_gift_claimed_at
    if (last && Date.now() - last < ONE_MONTH_MS) {
      const daysLeft = Math.ceil((ONE_MONTH_MS - (Date.now() - last)) / (24 * 60 * 60 * 1000))
      await sendMessage(
        token,
        chatId,
        `🎁 شما قبلاً این جایزه را دریافت کرده‌اید.\nتا دریافت جایزه بعدی ${daysLeft} روز مانده.`,
        mainKeyboard(),
      )
      return
    }
    await updateUser(env, pro.uuid, { wiki_gift_claimed_at: Date.now() })
    await sendMessage(
      token,
      chatId,
      `🎁 <b>جایزه ویژه VIP شما</b>\n\nاین کانفیگ به مدت ۱ ماه معتبر است:\n<code>${giftLink}</code>\n\nهر ۳۰ روز یک‌بار می‌توانید دوباره از همین دکمه دریافت کنید.`,
      mainKeyboard(),
    )
    return
  }

  if (text === '/help') {
    await sendMessage(
      token,
      chatId,
      `🤖 <b>دستورات ربات</b>\n\n` +
        `${BTN_TRIAL} — دریافت اشتراک تست\n` +
        `${BTN_USAGE} — مشاهده میزان مصرف (تست و VIP جدا)\n` +
        `${BTN_VIP} — درخواست اشتراک VIP\n` +
        `${BTN_WIKI_GIFT} — دریافت جایزه ماهانه ویژه کاربران VIP`,
      mainKeyboard(),
    )
    return
  }
}
