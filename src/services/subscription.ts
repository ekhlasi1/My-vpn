import type { UserRow } from '../db/queries'

/**
 * Generates a single VLESS subscription URL.
 * @param uuid - User UUID
 * @param url - Request URL
 * @param remark - Optional display name (the part after `#`). Defaults to the hostname.
 * @param hostOverride - Optional host/path override, used to point a config at a
 *   different worker in the backend pool (see requirement #4) instead of the
 *   worker that is currently serving the subscription request.
 */
export function generateSubscription(uuid: string, url: URL, remark?: string, hostOverride?: string): string {
  const host = hostOverride || url.hostname
  const name = encodeURIComponent(remark || host)
  return `vless://${uuid}@${host}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=ws&ed=4096#${name}`
}

/**
 * Generates a VLESS configuration object
 * @param uuid - User UUID
 * @param url - Request URL
 * @returns VLESS configuration object
 */
export function generateVlessConfig(uuid: string, url: URL): any {
  return {
    v: "2",
    ps: url.hostname,
    add: url.hostname,
    port: "443",
    id: uuid,
    aid: "0",
    net: "ws",
    type: "none",
    host: url.hostname,
    path: "/ws",
    tls: "tls",
    sni: url.hostname,
    fp: "chrome"
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
    vlessJson: generateVlessConfig(uuid, url)
  }
}

/** How many distinct configs an active 'pro' user gets (requirement #2). */
export const PRO_CONFIG_COUNT = 5

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
 *
 * Config remarks (the `#name` shown in the client app) intentionally never
 * include the buyer's own Telegram name/id — only the brand and the
 * admin/seller's username, so a shared screenshot of the config list never
 * leaks which config belongs to which customer.
 *
 * NOTE: Cloudflare Workers cannot select which country a connection egresses
 * from - a Worker has no concept of "exit node country". The old fake
 * per-country ("Germany", "USA", ...) labels have been removed; configs are
 * now differentiated by which real backend worker they connect to.
 */
export function buildUserSubscription(
  user: Pick<UserRow, 'uuid' | 'type' | 'status' | 'telegram_name' | 'telegram_id'>,
  url: URL,
  opts: { brandName?: string; adminUsername?: string; poolHosts?: string[] } = {},
): { name: string; link: string }[] {
  const brand = opts.brandName || 'BNDMAX VPN'
  const adminUsername = opts.adminUsername || 'vahidekhlasi'

  const entries: { name: string; link: string }[] = []

  if (user.type === 'pro') {
    const poolHosts = (opts.poolHosts || []).filter(Boolean)
    for (let i = 0; i < PRO_CONFIG_COUNT; i++) {
      const name = `👑 ${brand} VIP | سرور ${i + 1} | @${adminUsername}`
      const hostOverride = poolHosts.length ? poolHosts[i % poolHosts.length] : undefined
      entries.push({ name, link: generateSubscription(user.uuid, url, name, hostOverride) })
    }
  } else {
    const name = `${brand} | خرید: @${adminUsername}`
    entries.push({ name, link: generateSubscription(user.uuid, url, name) })
  }

  return entries
}

/** Plain-text subscription body (one config per line) for VLESS clients that import from a URL. */
export function buildSubscriptionText(entries: { link: string }[]): string {
  return entries.map((e) => e.link).join('\n')
}
