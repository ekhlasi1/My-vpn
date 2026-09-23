// Shared "country tag" lookup for backend_pool accounts and clean_ips rows.
//
// IMPORTANT: this is a purely cosmetic, admin-entered label — see the notes
// in src/services/subscription.ts, src/db/queries.ts (clean_ips) and
// CHANGELOG-v10.md. Cloudflare Workers have no concept of "exit country",
// so nothing here is verified or measured automatically. Only tag an
// account/IP with a country the admin has actually confirmed (e.g. it's a
// worker deployed by/for someone in that country, or a rented VPS whose
// real location is known) — mislabeling this is what the project's earlier
// "fake per-country configs" feature got removed for (migration-v3.sql).
//
// Keep this list in sync with the inline COUNTRY_FLAGS map used by the
// dashboard's client-side script in src/pages/admin.ts (that copy runs in
// the browser and can't import this module directly).

export const COUNTRY_FLAGS: Record<string, string> = {
  DE: '🇩🇪',
  TR: '🇹🇷',
  AE: '🇦🇪',
  FR: '🇫🇷',
  IT: '🇮🇹',
  RU: '🇷🇺',
  NL: '🇳🇱',
  GB: '🇬🇧',
  US: '🇺🇸',
}

export const COUNTRY_NAMES_FA: Record<string, string> = {
  DE: 'آلمان',
  TR: 'ترکیه',
  AE: 'امارات',
  FR: 'فرانسه',
  IT: 'ایتالیا',
  RU: 'روسیه',
  NL: 'هلند',
  GB: 'انگلستان',
  US: 'آمریکا',
}

export function isKnownCountryCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(COUNTRY_FLAGS, code)
}

/** Flag emoji for an ISO 3166-1 alpha-2 code, or '' if unset/unknown. */
export function countryFlag(code?: string | null): string {
  if (!code) return ''
  return COUNTRY_FLAGS[code] || ''
}

/** Persian display name for a country code, or the raw code if we don't have a translation. */
export function countryNameFa(code?: string | null): string {
  if (!code) return ''
  return COUNTRY_NAMES_FA[code] || code
}
