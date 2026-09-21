import type { UserRow } from '../db/queries'
import { countryFlag, countryNameFa } from '../utils/countries'

export interface SubscriptionOptions {
  /**
   * Points host + sni + the actual connect address at a DIFFERENT worker
   * (used by the backend pool / multi-account feature, requirement #4-old).
   * Whenever this is set, that other worker's own D1 MUST already contain
   * this uuid (see syncUserToAllAccounts / the pool backfill in
   * db/queries.ts) or the VLESS handshake will be rejected as "invalid
   * user" even though the TCP/TLS connection itself succeeds.
   */
  hostOverride?: string
  /**
   * Overrides ONLY the address xray/v2ray actually dials (the `add` field),
   * while `host` (the WS Host header) and `sni` (the TLS SNI) stay on the
   * real worker domain. This is safe and is the standard technique behind
   * "clean IP" configs: Cloudflare's edge terminates TLS by SNI and routes
   * the HTTP request by the Host header, regardless of which anycast IP/edge
   * node was actually dialed — so swapping the dialed IP for one the admin
   * has manually confirmed works reduces IP-level filtering without
   * touching routing at all. See the manually-entered healthy-IP list in
   * db/queries.ts (requirement #5).
   */
  ipOverride?: string
  /** Overrides the port dialed alongside ipOverride (defaults to 443 when unset). */
  portOverride?: string
}

/**
 * Generates a single VLESS subscription URL.
 * @param uuid - User UUID
 * @param url - Request URL
 * @param remark - Optional display name (the part after `#`). Defaults to the hostname.
 */
export function generateSubscription(uuid: string, url: URL, remark?: string, opts: SubscriptionOptions = {}): string {
  const host = opts.hostOverride || url.hostname
  const address = opts.ipOverride || host
  const port = opts.ipOverride ? opts.portOverride || '443' : '443'
  const name = encodeURIComponent(remark || host)
  // NOTE on params:
  //  - `path` MUST be a URL-encoded absolute path ("%2Fws", i.e. "/ws"). The
  //    previous version sent a bare "ws" (no leading slash), which is not a
  //    valid WebSocket resource path — most xray/sing-box based clients
  //    (v2rayNG, NekoBox, Hiddify, sing-box core) either silently rewrite it
  //    or fail the handshake outright depending on version, which was one
  //    cause of "configs that pass the ping test but the tunnel itself
  //    doesn't pass traffic".
  //  - `alpn` is left EMPTY on purpose. Pinning it to h2/http1.1 was meant to
  //    match an ordinary Chrome ClientHello, but in practice it was the cause
  //    of the "ping named servers" failures reported against Cloudflare's
  //    edge for this setup — leaving it blank lets the client/server
  //    negotiate normally and fixes those pings.
  //  - `fp=chrome` (uTLS fingerprint) is kept; only `alpn` needed to be emptied.
  return (
    `vless://${uuid}@${address}:${port}?encryption=none&security=tls&sni=${host}` +
    `&fp=chrome&alpn=&type=ws&host=${host}&path=%2Fws&ed=4096#${name}`
  )
}

/**
 * Generates a VLESS configuration object
 * @param uuid - User UUID
 * @param url - Request URL
 * @returns VLESS configuration object
 */
export function generateVlessConfig(uuid: string, url: URL, opts: SubscriptionOptions = {}): any {
  const host = opts.hostOverride || url.hostname
  const address = opts.ipOverride || host
  const port = opts.ipOverride ? opts.portOverride || '443' : '443'
  return {
    v: '2',
    ps: url.hostname,
    add: address,
    port,
    id: uuid,
    aid: '0',
    net: 'ws',
    type: 'none',
    host: host,
    path: '/ws',
    tls: 'tls',
    sni: host,
    // Left empty — see the matching comment in generateSubscription() above.
    alpn: '',
    fp: 'chrome',
  }
}

/**
 * Generates all configuration formats as a single object
 * @param uuid - User UUID
 * @param url - Request URL
 * @returns Object containing all configuration formats
 */
export function generateAllConfigs(uuid: string, url: URL): any {
  return {
    vless: generateSubscription(uuid, url),
    vlessJson: generateVlessConfig(uuid, url),
  }
}

/** How many distinct configs an active 'pro' user gets (requirement #2). */
export const PRO_CONFIG_COUNT = 5

/**
 * How many extra, per-IP configs (on top of the PRO_CONFIG_COUNT automatic
 * ones) get appended from the admin's manually-curated healthy-IP list (the
 * "🌐 آی‌پی‌های سالم" list in the dashboard, populated either by hand or by
 * ticking results in the Radar/manual scanner and hitting "add selected").
 * Must match MAX_CLEAN_IPS in src/db/queries.ts, which is what actually caps
 * the underlying list (oldest row evicted first once it's full).
 */
export const MAX_EXTRA_CLEAN_IP_CONFIGS = 15

/**
 * Builds the full list of subscription entries a managed (trial/pro) user should
 * see when they open their personal `/<uuid>` link:
 *  - trial users: a single config.
 *  - active 'pro' users: PRO_CONFIG_COUNT (5) configs, named "سرور ۱".."سرور ۵".
 *    If a backend worker pool is configured (requirement #4), each extra config
 *    points at a different worker host drawn from the pool's currently-active
 *    rotation batch, so VIP users genuinely spread their connections across
 *    several Cloudflare Workers instead of all hammering one. If no pool is
 *    configured, all 5 configs point at the current worker (still useful:
 *    most VPN clients let the user pick/ping-test between saved configs).
 *  - if the admin has manually entered a healthy IP:port and turned the
 *    override on (requirement #5), it's used as the connect address for
 *    every config, on top of whichever host each config already points to —
 *    sni/host are untouched, so this never breaks pool routing, it only
 *    swaps which literal IP:port gets dialed.
 *
 * Config remarks (the `#name` shown in the client app) intentionally never
 * include the buyer's own Telegram name/id — only the brand and the
 * admin/seller's username, so a shared screenshot of the config list never
 * leaks which config belongs to which customer.
 *
 * NOTE: Cloudflare Workers cannot select which country a connection egresses
 * from - a Worker has no concept of "exit node country". The old fake
 * per-country ("Germany", "USA", ...) labels (migration-v3.sql) were removed
 * for exactly that reason: they weren't true.
 *
 * v11 reintroduces a country label, but tied to something real and
 * admin-attested rather than fabricated: each backend_pool account can
 * optionally be tagged with a country (see src/utils/countries.ts /
 * migration-v11.sql) — e.g. because that worker/account genuinely belongs to
 * or was deployed for someone in that country. When a config's connection is
 * pointed at a tagged account, its name can show that account's flag +
 * country instead of the generic "سرور N". This is still 100% manual and
 * unverified — it reflects whatever the admin entered in the "پنل‌ها" tab,
 * not anything Cloudflare confirms — so only tag accounts you can actually
 * vouch for, the same rule that applies to the clean_ips.country tag.
 */
/**
 * Default display-name templates, used whenever the admin hasn't set a
 * custom one. Placeholders:
 *   {brand}   - brand_name setting
 *   {admin}   - telegram_admin_username setting
 *   {n}       - config/server number, 1..PRO_CONFIG_COUNT (pro only)
 *   {flag}    - flag emoji for that config's pool-account country tag, or '' if untagged (pro only)
 *   {country} - Persian country name for that tag, or '' if untagged (pro only)
 */
export const DEFAULT_PRO_CONFIG_NAME = '{flag} {brand} VIP |{country}{n} | @{admin}'
export const DEFAULT_TRIAL_CONFIG_NAME = '{brand} | خرید: @{admin}'

/** Fills {brand}/{admin}/{n}/{flag}/{country} placeholders in an admin-editable config-name template. */
function renderConfigName(
  template: string,
  vars: { brand: string; admin: string; n?: number; flag?: string; country?: string },
): string {
  return template
    .replace(/\{brand\}/g, vars.brand)
    .replace(/\{admin\}/g, vars.admin)
    .replace(/\{n\}/g, vars.n !== undefined ? String(vars.n) : '')
    .replace(/\{flag\}/g, vars.flag ?? '')
    .replace(/\{country\}/g, vars.country ?? '')
}

/** One rotation-pool backend, optionally tagged with a country for display (see DEFAULT_PRO_CONFIG_NAME above). */
export interface PoolHostEntry {
  hostname: string
  country?: string | null
}

/**
 * Display names for the extra, per-IP configs built from the admin's
 * curated healthy/clean-IP list (see MAX_EXTRA_CLEAN_IP_CONFIGS above).
 * Previously each entry was named "آی‌پی سالم N"; now every entry gets a
 * random pick from this "premium/dedicated/professional" pool instead, so
 * two different users (or two different regenerations for the same user)
 * don't necessarily see the same name on the same IP. 15 entries so a full
 * MAX_EXTRA_CLEAN_IP_CONFIGS list never has to repeat a name.
 */
const PREMIUM_SERVER_NAME_POOL = [
  'سرور ویژه ۱', 'سرور ویژه ۲', 'سرور ویژه ۳', 'سرور ویژه ۴', 'سرور ویژه ۵',
  'سرور اختصاصی ۱', 'سرور اختصاصی ۲', 'سرور اختصاصی ۳', 'سرور اختصاصی ۴', 'سرور اختصاصی ۵',
  'سرور حرفه‌ای ۱', 'سرور حرفه‌ای ۲', 'سرور حرفه‌ای ۳', 'سرور حرفه‌ای ۴', 'سرور حرفه‌ای ۵',
]

/** Fisher–Yates shuffle of PREMIUM_SERVER_NAME_POOL, called fresh per buildUserSubscription() so naming is randomized each time. */
function shuffledPremiumServerNames(): string[] {
  const arr = [...PREMIUM_SERVER_NAME_POOL]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function buildUserSubscription(
  user: Pick<UserRow, 'uuid' | 'type' | 'status' | 'telegram_name' | 'telegram_id'>,
  url: URL,
  opts: {
    brandName?: string
    adminUsername?: string
    poolHosts?: PoolHostEntry[]
    cleanIp?: string | null
    /** Port that goes with cleanIp (from the manually-entered healthy-IP list). Ignored if cleanIp is unset. */
    cleanPort?: number | null
    /** Admin-editable template for pro/VIP config names (placeholders: {brand} {admin} {n} {flag} {country}). */
    proConfigName?: string
    /** Admin-editable template for the trial/test config name (placeholders: {brand} {admin}). */
    trialConfigName?: string
    /**
     * The admin's curated healthy-IP list (see MAX_EXTRA_CLEAN_IP_CONFIGS
     * above) — one extra config is appended per entry, up to the cap, on
     * top of the automatic ones built below. Unrelated to cleanIp/cleanPort
     * above: those override the address used by every automatic config;
     * this instead gives each selected IP its own separate, named config so
     * the user (or the admin, ping-testing from the dashboard) can pick
     * between them directly.
     */
    extraCleanIps?: { ip: string; port: number; country?: string | null }[]
  } = {},
): { name: string; link: string }[] {
  const brand = opts.brandName || 'BNDMAX VPN'
  const adminUsername = opts.adminUsername || 'vahidekhlasi'
  const ipOverride = opts.cleanIp || undefined
  const portOverride = opts.cleanPort ? String(opts.cleanPort) : undefined
  const proTemplate = opts.proConfigName || DEFAULT_PRO_CONFIG_NAME
  const trialTemplate = opts.trialConfigName || DEFAULT_TRIAL_CONFIG_NAME

  const entries: { name: string; link: string }[] = []

  if (user.type === 'pro') {
    const poolHosts = (opts.poolHosts || []).filter((h) => h && h.hostname)
    for (let i = 0; i < PRO_CONFIG_COUNT; i++) {
      const host = poolHosts.length ? poolHosts[i % poolHosts.length] : undefined
      const name = renderConfigName(proTemplate, {
        brand,
        admin: adminUsername,
        n: i + 1,
        flag: countryFlag(host?.country),
        country: countryNameFa(host?.country),
      })
      const hostOverride = host?.hostname
      entries.push({ name, link: generateSubscription(user.uuid, url, name, { hostOverride, ipOverride, portOverride }) })
    }
  } else {
    const name = renderConfigName(trialTemplate, { brand, admin: adminUsername })
    entries.push({ name, link: generateSubscription(user.uuid, url, name, { ipOverride, portOverride }) })
  }

  const extras = (opts.extraCleanIps || []).slice(0, MAX_EXTRA_CLEAN_IP_CONFIGS)
  const premiumNamePool = shuffledPremiumServerNames()
  extras.forEach((row, i) => {
    const flag = countryFlag(row.country)
    const country = countryNameFa(row.country)
    const label = [flag, country].filter(Boolean).join(' ')
    const baseName = premiumNamePool[i % premiumNamePool.length]
    const name = `🌐 ${brand} | ${baseName}${label ? ' | ' + label : ''}`
    entries.push({
      name,
      link: generateSubscription(user.uuid, url, name, { ipOverride: row.ip, portOverride: String(row.port) }),
    })
  })

  return entries
}

/** Plain-text subscription body (one config per line) — the un-encoded form, kept for `?format=plain` debugging. */
export function buildSubscriptionText(entries: { link: string }[]): string {
  return entries.map((e) => e.link).join('\n')
}

/**
 * The body that is actually sent to subscription clients: the newline-joined
 * links, Base64-encoded. That is the de-facto standard "V2Ray subscription"
 * format (v2rayN/NG, NekoBox, Hiddify, Streisand, V2Box, Shadowrocket, ...
 * all understand it). Sending raw lines only works on the subset of clients
 * that fall back to plain text when Base64 decoding fails; on the others the
 * import silently yields "0 configs". Every link is pure ASCII (remarks are
 * percent-encoded) but we still go through UTF-8 bytes so this can never throw.
 */
export function buildSubscriptionBody(entries: { link: string }[], plain = false): string {
  const text = buildSubscriptionText(entries)
  if (plain) return text
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
