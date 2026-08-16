import type { Env } from '../core/types'
import {
  getExpiringTrialCandidates,
  getOverQuotaCandidates,
  get80PercentCandidates,
  updateUser,
  getSetting,
} from '../db/queries'
import { sendMessage } from '../telegram/api'

function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} گیگابایت`
  return `${mb.toFixed(0)} مگابایت`
}

export async function runScheduledMaintenance(env: Env): Promise<void> {
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
}
