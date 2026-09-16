/**
 * Rented/owned servers — quick-edit list
 * ======================================
 * This is for servers YOU rent or own yourself (e.g. a weekly VPS you
 * re-provision), where updating a value in the admin dashboard every few
 * days is annoying. Edit the array below and redeploy (`npm run deploy`)
 * whenever a server's address changes — that's it, no DB writes needed.
 *
 * IMPORTANT — this is still just the "manually-entered healthy IP" feature
 * (see docs comment in src/db/queries.ts). Nothing here is scanned, tested,
 * or auto-discovered; only put addresses here that you personally control
 * and have verified are yours (e.g. from your hosting provider's control
 * panel / invoice). Do NOT paste in third-party or scraped proxy lists —
 * those still won't be honored by getBestCleanIp() and using someone else's
 * server without their permission isn't something this project supports.
 *
 * Each entry is combined with whatever is in the `clean_ips` D1 table (the
 * dashboard's "پنل‌ها" tab) when building the healthy-IP pool — you can use
 * one, the other, or both together.
 */

export interface RentedCleanIp {
  /** ISO 3166-1 alpha-2 country code, just for display (e.g. "DE", "TR", "AE"). */
  country: string
  ip: string
  port: number
  /** Optional free-text note shown in the dashboard table. */
  note?: string
}

export const RENTED_CLEAN_IPS: RentedCleanIp[] = [
  // Germany — weekly-rented VPS (control panel screenshot verified 2026-09-06).
  // Update ip/port here each time the rental renews with a new address.
  { country: 'DE', ip: '89.187.155.67', port: 2080, note: 'VPS آلمان - اجاره هفتگی' },

  // Add more of YOUR OWN verified servers below, e.g.:
  // { country: 'TR', ip: '1.2.3.4', port: 443, note: 'VPS ترکیه' },
  // { country: 'AE', ip: '5.6.7.8', port: 443, note: 'VPS امارات' },
]
