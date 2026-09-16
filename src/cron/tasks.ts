import type { Env } from '../core/types'
import {
  getExpiringTrialCandidates,
  getOverQuotaCandidates,
  get80PercentCandidates,
  updateUser,
  getSetting,
  setSetting,
  listBotUsers,
} from '../db/queries'
import { sendMessage, broadcastToAll } from '../telegram/api'

function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} گیگابایت`
  return `${mb.toFixed(0)} مگابایت`
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The recurring "servers updated / hosting bill paid" reassurance message —
 * sent automatically once a week (see runWeeklyUpdateBroadcast below) to
 * every Telegram account that has ever messaged the bot (same audience as
 * /stats' "کل کاربران ربات"), and also reusable by the admin's manual
 * /broadcast command if they just want to resend this exact text.
 */
export function buildWeeklyUpdateMessage(brand: string): string {
  return (
    `✨ <b>بروزرسانی هفتگی ${brand}</b> ✨\n\n` +
    `سلام دوست عزیز 👋\n\n` +
    `سرورها با موفقیت بروزرسانی و بهینه‌سازی شدند ⚙️🚀\n` +
    `هزینه‌ی نگهداری و تمدید سرویس این هفته هم به‌طور کامل پرداخت شد ✅💳\n\n` +
    `اتصال شما پایدار، امن و بدون وقفه ادامه داره 🔒🌐\n` +
    `ممنون که همراه ما هستید 🙏💚\n\n` +
    `برای مشاهده وضعیت اشتراک خودتون: 📊 وضعیت مصرف من`
  )
}

/**
 * Fires at most once every 7 days (tracked via the `last_weekly_update_broadcast_at`
 * setting), sending buildWeeklyUpdateMessage() to every known bot user.
 * Called from runScheduledMaintenance, which already self-throttles to
 * roughly once/hour (see maybeRunMaintenance in core/handler.ts) — so this
 * check just needs to compare against that hourly heartbeat, not implement
 * its own scheduling.
 */
async function runWeeklyUpdateBroadcast(env: Env, token: string): Promise<void> {
  if (!token) return
  const enabled = (await getSetting(env, 'weekly_update_broadcast_enabled')) !== '0'
  if (!enabled) return
  const lastSent = parseFloat(await getSetting(env, 'last_weekly_update_broadcast_at')) || 0
  if (Date.now() - lastSent < WEEK_MS) return

  // Stamp the timestamp BEFORE sending so a slow broadcast (or a maintenance
  // race from a concurrent request) can't trigger a duplicate send.
  await setSetting(env, 'last_weekly_update_broadcast_at', String(Date.now()))

  const brand = await getSetting(env, 'brand_name')
  const botUsers = await listBotUsers(env, 100000)
  const chatIds = botUsers.map((u) => u.telegram_id).filter(Boolean)
  if (chatIds.length === 0) return

  await broadcastToAll(token, chatIds, buildWeeklyUpdateMessage(brand || 'BNDMAX VPN'))
}

export async function runScheduledMaintenance(env: Env, domain?: string): Promise<void> {
  if (!env.DB) return
  const token = await getSetting(env, 'telegram_bot_token')

  // 1. Expire users whose time limit has passed
  const expired = await getExpiringTrialCandidates(env)
  for (const u of expired) {
    await updateUser(env, u.uuid, { status: 'expired' })
    if (token && u.telegram_id) {
      await sendMessage(
        token,
        u.telegram_id,
        `⛔ اشتراک ${u.type === 'pro' ? 'VIP' : 'تست'} شما به پایان رسید.\n\nبرای دریافت اشتراک جدید: /start یا /pro`,
      )
    }
  }

  // 2. Suspend users who exceeded their volume quota
  const overQuota = await getOverQuotaCandidates(env)
  for (const u of overQuota) {
    await updateUser(env, u.uuid, { status: 'expired' })
    if (token && u.telegram_id) {
      await sendMessage(
        token,
        u.telegram_id,
        `⛔ حجم اشتراک ${u.type === 'pro' ? 'VIP' : 'تست'} شما تمام شد.\n\nبرای دریافت اشتراک جدید: /start یا /pro`,
      )
    }
  }

  // 3. Warn users who crossed 80% of their volume quota
  const warn80 = await get80PercentCandidates(env)
  for (const u of warn80) {
    await updateUser(env, u.uuid, { warned_80: 1 })
    if (token && u.telegram_id) {
      const percent = (u.volume_used_mb / u.volume_limit_mb) * 100
      await sendMessage(
        token,
        u.telegram_id,
        `⚠️ شما ${percent.toFixed(0)}٪ از حجم اشتراک ${u.type === 'pro' ? 'VIP' : 'تست'} خود را مصرف کرده‌اید (${fmtMb(u.volume_used_mb)} از ${fmtMb(u.volume_limit_mb)}).\n\nبرای مشاهده جزئیات: /usage`,
      )
    }
  }

  // 4. Weekly "servers updated / hosting paid" reassurance broadcast to everyone.
  await runWeeklyUpdateBroadcast(env, token)

  // Requirement #5's "healthy IP" list is now a manually-entered list (no
  // scanning), managed entirely via the dashboard's clean-ips admin API —
  // nothing to run here on a schedule. `domain` is kept as a parameter for
  // backward compatibility with any code still calling this with a domain,
  // but is unused here now.
  void domain
}
