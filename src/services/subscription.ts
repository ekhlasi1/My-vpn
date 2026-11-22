import type { UserRow } from '../db/queries'
import { toBase64 } from '../utils/helpers'

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
   * node was actually dialed — so swapping the dialed IP for one that isn't
   * currently on an ISP's blocklist reduces IP-level filtering without
   * touching routing at all. See src/services/clean-ips.ts (requirement #5).
   */
  ipOverride?: string
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
  const name = encodeURIComponent(remark || host)
  // NOTE on params:
  //  - `path` MUST be a URL-encoded absolute path ("%2Fws", i.e. "/ws"). The
  //    previous version sent a bare "ws" (no leading slash), which is not a
  //    valid WebSocket resource path — most xray/sing-box based clients
  //    (v2rayNG, NekoBox, Hiddify, sing-box core) either silently rewrite it
  //    or fail the handshake outright depending on version, which was one
  //    cause of "configs that pass the ping test but the tunnel itself
  //    doesn't pass traffic".
  //  - `alpn` MUST be http/1.1 for a WebSocket transport. Offering h2 lets
  //    Cloudflare negotiate HTTP/2 during the TLS handshake, and then the
  //    classic "Upgrade: websocket" request that v2ray/xray sends is not valid
  //    on that connection — the client connects, "pings" fine, but the tunnel
  //    never carries any traffic. (Earlier versions advertised h2,http/1.1.)
  //  - No `ed` (early data) parameter: it is not part of the standard VLESS
  //    share-link format, and clients that don't understand it ignore it.
  //    Early data, if wanted, goes inside the path (path=/ws?ed=2560) and is
  //    fully supported by the server side (src/network/websocket.ts).
  //  - `fp=chrome` (uTLS fingerprint) makes the ClientHello look like Chrome.
  return (
    `vless://${uuid}@${address}:443?encryption=none&security=tls&sni=${host}` +
    `&fp=chrome&alpn=http%2F1.1&type=ws&host=${host}&path=%2Fws#${name}`
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
  return {
    v: '2',
    ps: url.hostname,
    add: address,
    port: '443',
    id: uuid,
    aid: '0',
    net: 'ws',
    type: 'none',
    host: host,
    path: '/ws',
    tls: 'tls',
    sni: host,
    alpn: 'http/1.1',
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
 *  - if a healthy "clean IP" is on file (requirement #5), it's used as the
 *    connect address for every config, on top of whichever host each config
 *    already points to — sni/host are untouched, so this never breaks pool
 *    routing, it only swaps which literal IP gets dialed.
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
/** Default display-name templates, used whenever the admin hasn't set a custom one. */
export const DEFAULT_PRO_CONFIG_NAME = '👑 {brand} VIP | سرور {n} | @{admin}'
export const DEFAULT_TRIAL_CONFIG_NAME = '{brand} | خرید: @{admin}'

/** Fills {brand}/{admin}/{n} placeholders in an admin-editable config-name template. */
function renderConfigName(template: string, vars: { brand: string; admin: string; n?: number }): string {
  return template
    .replace(/\{brand\}/g, vars.brand)
    .replace(/\{admin\}/g, vars.admin)
    .replace(/\{n\}/g, vars.n !== undefined ? String(vars.n) : '')
}

export function buildUserSubscription(
  user: Pick<UserRow, 'uuid' | 'type' | 'status' | 'telegram_name' | 'telegram_id'>,
  url: URL,
  opts: {
    brandName?: string
    adminUsername?: string
    poolHosts?: string[]
    cleanIp?: string | null
    /** Admin-editable template for pro/VIP config names (placeholders: {brand} {admin} {n}). */
    proConfigName?: string
    /** Admin-editable template for the trial/test config name (placeholders: {brand} {admin}). */
    trialConfigName?: string
  } = {},
): { name: string; link: string }[] {
  const brand = opts.brandName || 'BNDMAX VPN'
  const adminUsername = opts.adminUsername || 'vahidekhlasi'
  const ipOverride = opts.cleanIp || undefined
  const proTemplate = opts.proConfigName || DEFAULT_PRO_CONFIG_NAME
  const trialTemplate = opts.trialConfigName || DEFAULT_TRIAL_CONFIG_NAME

  const entries: { name: string; link: string }[] = []

  if (user.type === 'pro') {
    const poolHosts = (opts.poolHosts || []).filter(Boolean)
    for (let i = 0; i < PRO_CONFIG_COUNT; i++) {
      const name = renderConfigName(proTemplate, { brand, admin: adminUsername, n: i + 1 })
      const hostOverride = poolHosts.length ? poolHosts[i % poolHosts.length] : undefined
      entries.push({ name, link: generateSubscription(user.uuid, url, name, { hostOverride, ipOverride }) })
    }
  } else {
    const name = renderConfigName(trialTemplate, { brand, admin: adminUsername })
    entries.push({ name, link: generateSubscription(user.uuid, url, name, { ipOverride }) })
  }

  return entries
}

/** Plain-text subscription body (one config per line). */
export function buildSubscriptionText(entries: { link: string }[]): string {
  return entries.map((e) => e.link).join('\n')
}

/**
 * Standard subscription body: the config list, base64-encoded. This is the
 * format every v2ray-family client (v2rayN, v2rayNG, NekoBox, Hiddify,
 * Streisand, Shadowrocket, sing-box, ...) understands for "subscription URL"
 * imports; some of them do not accept a bare plain-text list.
 */
export function buildSubscriptionBody(entries: { link: string }[]): string {
  return toBase64(buildSubscriptionText(entries))
}

/** Headers shared by every subscription response. */
export function subscriptionHeaders(
  title: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    // Clients re-fetch the subscription on their own every 12 hours.
    'Profile-Update-Interval': '12',
    'Profile-Title': `base64:${toBase64(title)}`,
    ...extra,
  }
}
