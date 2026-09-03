import type { UserRow, CleanIpPick } from '../db/queries'
import { flagForColo } from './clean-ips'

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
 * Swaps ONLY the `#name` fragment of an already-built vless link, keeping
 * everything before it (address/port/uuid/host/sni/path/clean-IP/etc)
 * untouched. Used to re-brand a config that was LIVE-EXTRACTED from another
 * account's own worker (see getLivePoolConfigOverrides in db/queries.ts) —
 * that link is guaranteed to work against the worker that generated it, so
 * the only thing worth changing locally is the display name shown to the
 * end user (brand/admin/slot number), never the connection details.
 */
export function withConfigName(link: string, name: string): string {
  const hashIdx = link.indexOf('#')
  const base = hashIdx >= 0 ? link.slice(0, hashIdx) : link
  return `${base}#${encodeURIComponent(name)}`
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
  // Reverted to the pre-"gaming/ping tuning" link format at the user's
  // request: no `alpn` param, plain `fp=chrome`, same as the previous
  // deployment.
  //
  // One piece kept as-is: `path` stays the URL-encoded absolute path
  // ("%2Fws", i.e. "/ws"), NOT the old bare "ws" (no leading slash). A bare
  // "ws" is not a valid WebSocket resource path — most xray/sing-box based
  // clients (v2rayNG, NekoBox, Hiddify, sing-box core) either silently
  // rewrite it or fail the handshake outright depending on version. That was
  // one of the documented causes of "config pings fine but no traffic passes
  // through the tunnel" — reverting it would reproduce that exact symptom,
  // so it's left corrected.
  return (
    `vless://${uuid}@${address}:443?encryption=none&security=tls&sni=${host}` +
    `&fp=chrome&type=ws&host=${host}&path=%2Fws&ed=4096#${name}`
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
 *  - clean-IP connect addresses (requirement #5), per config slot:
 *      - the first 2 pro configs always get the 2 best AUTO-discovered
 *        healthy IPs (opts.autoCleanIps), same as the feature behaved before
 *        the admin-approval step existed — no admin action needed.
 *      - the remaining 3 pro configs get the admin's own approved/tested IPs
 *        (opts.selectedCleanIps), in the order the admin picked them.
 *      - any slot that doesn't have a corresponding entry yet (not enough
 *        auto IPs discovered yet, or the admin hasn't approved 3 yet) simply
 *        falls back to the plain worker host — exactly like configs looked
 *        before this feature existed.
 *      - sni/host are untouched in every case, so none of this ever breaks
 *        pool routing; it only swaps which literal IP gets dialed.
 *  - each config's display name is prefixed with a flag emoji for the
 *    country its connect IP was detected in (🌐 for plain-host/unknown
 *    fallback slots) - requirement: show the country flag first.
 *
 * Config remarks (the `#name` shown in the client app) intentionally never
 * include the buyer's own Telegram name/id — only the brand and the
 * admin/seller's username, so a shared screenshot of the config list never
 * leaks which config belongs to which customer.
 *
 * NOTE: Cloudflare Workers cannot select which country a connection egresses
 * from - a Worker has no concept of "exit node country". Country flags shown
 * here reflect the detected colo of whichever clean IP (if any) that config
 * slot is using, not a genuine VPN "exit country".
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
    /**
     * Live-extracted, guaranteed-working vless links for some/all of
     * `poolHosts`, keyed by hostname (see getLivePoolConfigOverrides in
     * db/queries.ts — requirements #1/#2, multi-account reliability). When a
     * slot's chosen pool host has an entry here, that REAL link (fetched
     * straight from the other account's own worker, after re-syncing the
     * user there) is used as-is (only re-branded via withConfigName) instead
     * of being reconstructed locally from just the hostname — which is what
     * used to silently break whenever that other account's D1 had drifted
     * out of sync. Hosts missing from this map (extraction failed, timed
     * out, or wasn't attempted) fall back to the old local construction, so
     * this is purely additive/safer, never a hard dependency.
     */
    poolLinkOverrides?: Record<string, string>
    /** The 2 auto-discovered healthy clean IPs (requirement #1), fastest first. */
    autoCleanIps?: CleanIpPick[]
    /** Up to 3 admin-approved/tested clean IPs (requirement #1), in the admin's own order. */
    selectedCleanIps?: CleanIpPick[]
    /** Admin-editable template for pro/VIP config names (placeholders: {brand} {admin} {n}). */
    proConfigName?: string
    /** Admin-editable template for the trial/test config name (placeholders: {brand} {admin}). */
    trialConfigName?: string
  } = {},
): { name: string; link: string }[] {
  const brand = opts.brandName || 'BNDMAX VPN'
  const adminUsername = opts.adminUsername || 'vahidekhlasi'
  const proTemplate = opts.proConfigName || DEFAULT_PRO_CONFIG_NAME
  const trialTemplate = opts.trialConfigName || DEFAULT_TRIAL_CONFIG_NAME
  const autoCleanIps = opts.autoCleanIps || []
  const selectedCleanIps = opts.selectedCleanIps || []

  const entries: { name: string; link: string }[] = []

  if (user.type === 'pro') {
    const poolHosts = (opts.poolHosts || []).filter(Boolean)
    const poolLinkOverrides = opts.poolLinkOverrides || {}
    for (let i = 0; i < PRO_CONFIG_COUNT; i++) {
      // Slots 0-1: automatic clean IPs. Slots 2-4: admin-picked clean IPs.
      // Whichever list is short (or empty — nothing discovered/approved
      // yet), the missing slots fall back to `undefined`, i.e. the plain
      // worker host, exactly like before this feature existed.
      const pick: CleanIpPick | undefined = i < 2 ? autoCleanIps[i] : selectedCleanIps[i - 2]
      const flag = flagForColo(pick?.colo)
      const baseName = renderConfigName(proTemplate, { brand, admin: adminUsername, n: i + 1 })
      const name = `${flag} ${baseName}`
      const hostOverride = poolHosts.length ? poolHosts[i % poolHosts.length] : undefined
      const liveLink = hostOverride ? poolLinkOverrides[hostOverride] : undefined
      const link = liveLink
        ? withConfigName(liveLink, name)
        : generateSubscription(user.uuid, url, name, { hostOverride, ipOverride: pick?.ip })
      entries.push({ name, link })
    }
  } else {
    // Trial users only get one slot — prefer an admin-approved IP, then an
    // auto one, then plain fallback.
    const pick = selectedCleanIps[0] || autoCleanIps[0]
    const flag = flagForColo(pick?.colo)
    const baseName = renderConfigName(trialTemplate, { brand, admin: adminUsername })
    const name = `${flag} ${baseName}`
    entries.push({ name, link: generateSubscription(user.uuid, url, name, { ipOverride: pick?.ip }) })
  }

  return entries
}

/** Plain-text subscription body (one config per line) for VLESS clients that import from a URL. */
export function buildSubscriptionText(entries: { link: string }[]): string {
  return entries.map((e) => e.link).join('\n')
}
