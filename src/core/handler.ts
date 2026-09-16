// NOTE: indexPage() (the public marketing landing page) is intentionally kept
// but no longer routed at "/" — see requirement #7. It's still reachable at
// "/landing" below for forks that want it back as the default root.
import { errorPage, indexPage } from '../pages/index.ts'
import { setupPage, loginPage, dashboardPage } from '../pages/admin.ts'
import { generateSubscription, buildUserSubscription, buildSubscriptionText } from '../services/subscription.ts'
import { processWebSocket } from '../network/websocket.ts'
import { handleDohRequest } from '../network/doh.ts'
import { splitAndFilter } from '../utils/array.ts'
import { handleAdminApi } from '../api/admin.ts'
import { handleTelegramUpdate } from '../telegram/bot.ts'
import {
  hasAdminPassword,
  getUserByUuid,
  getAllSettings,
  checkAndIncrementQuota,
  getPoolRotation,
  getSetting,
  setSetting,
  getOrCreateWorkerSyncSecret,
  upsertSyncedUser,
  deleteSyncedUser,
  getBestCleanIp,
  listCleanIps,
  listDnsRules,
  getOrCreateOwnerSubPath,
} from '../db/queries.ts'
import { requireAdmin } from '../auth/session.ts'
import { runScheduledMaintenance } from '../cron/tasks.ts'
import { timingSafeEqual } from '../auth/password.ts'

import type { Env } from './types.ts'

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000 // hourly, same cadence as the old cron trigger

/**
 * Runs trial/pro expiry + volume-quota + 80%-warning maintenance without a
 * Cloudflare cron trigger at all (see the note in wrangler.toml for why —
 * the account-wide 5-cron-trigger limit was breaking deploys on the
 * multi-worker pool setup). Instead, it self-schedules: every request checks
 * a `last_maintenance_run` timestamp in D1, and if more than an hour has
 * passed, kicks the job off in the background (ctx.waitUntil — never blocks
 * the response) and immediately stamps the timestamp so concurrent requests
 * don't all trigger it at once. Every step inside runScheduledMaintenance is
 * idempotent, so an occasional double-run from a race is harmless.
 */
function maybeRunMaintenance(env: Env, ctx: ExecutionContext, domain: string): void {
  if (!env.DB) return
  ctx.waitUntil(
    (async () => {
      try {
        const lastRunStr = await getSetting(env, 'last_maintenance_run')
        const lastRun = parseFloat(lastRunStr) || 0
        if (Date.now() - lastRun < MAINTENANCE_INTERVAL_MS) return
        await setSetting(env, 'last_maintenance_run', String(Date.now()))
        await runScheduledMaintenance(env, domain)
      } catch (err) {
        console.error('maybeRunMaintenance failed:', err)
      }
    })(),
  )
}

/**
 * Main request handler for the BNDMAX VPN application
 * Handles both HTTP requests and WebSocket upgrade requests
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const earlyUrl = new URL(request.url)
    maybeRunMaintenance(env, ctx, earlyUrl.hostname)

    const upgradeHeader = request.headers.get('Upgrade')

    // Handle WebSocket upgrade requests (the actual VLESS proxy tunnel)
    if (upgradeHeader && upgradeHeader === 'websocket') {
      // Requirement #3: self-imposed daily request cap + manual kill switch.
      // Every proxy connection attempt counts against the daily quota; once
      // paused (manually or automatically), new connections are rejected
      // until the admin resumes the service or the UTC day rolls over.
      if (env.DB) {
        const quota = await checkAndIncrementQuota(env)
        if (!quota.allowed) {
          return new Response('سرویس موقتاً متوقف شده است. لطفاً بعداً تلاش کنید.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
      }
      return processWebSocket(request, env, ctx)
    }

    const url = earlyUrl

    // ---------- Root ----------
    // Requirement #7: the public marketing page (indexPage) stays in the
    // codebase but is disabled — the admin login/dashboard is served at "/"
    // instead, exactly like "/admin". If you fork this and want the public
    // page back at "/", just change this block to `return await indexPage()`.
    if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/') {
      const setupDone = await hasAdminPassword(env)
      if (!setupDone) return setupPage()
      const authed = await requireAdmin(request, env)
      if (!authed) return loginPage()
      return dashboardPage()
    }

    // Kept for forks that want the original public landing page back.
    if (url.pathname === '/landing') {
      return await indexPage()
    }
    if (url.pathname === '/admin/login') {
      const setupDone = await hasAdminPassword(env)
      if (!setupDone) return setupPage()
      return loginPage()
    }
    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdminApi(request, env, url)
    }

    // ---------- Worker-native DNS-over-HTTPS (Private DNS / DoH feature) ----------
    // Unlike DoT (port 853, requires the standalone dot-server/ VPS below),
    // DoH runs over plain HTTPS, so this Worker can answer it directly —
    // no extra infrastructure needed for any client that supports a custom
    // DoH URL (browsers, DoH-capable apps, curl --doh-url). Same routing
    // rules and same `dns_rules` D1 table as the DoT server; see
    // src/network/doh.ts and docs/private-dns-fa.md.
    if (url.pathname === '/dns-query' && (request.method === 'GET' || request.method === 'POST' || request.method === 'OPTIONS')) {
      return handleDohRequest(request, env)
    }

    // ---------- Public DNS routing list (Private DNS / DoT feature) ----------
    // Deliberately unauthenticated + CORS-open: this is the list the
    // standalone DoT server (dot-server/, run on separate infra — Workers
    // can't host a DNS-over-TLS listener on port 853) polls to decide which
    // domains/IPs/ranges get answered with a Cloudflare "clean" IP versus
    // resolved direct. It's meant to be shared publicly, not per-user.
    if (url.pathname === '/api/dns-rules' && request.method === 'GET') {
      if (!env.DB) return new Response(JSON.stringify({ rules: [], cleanIp: null }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      const [rules, cleanIpEntry] = await Promise.all([listDnsRules(env), getBestCleanIp(env)])
      return new Response(JSON.stringify({ rules, cleanIp: cleanIpEntry?.ip ?? null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
      })
    }

    // ---------- Telegram webhook ----------
    if (url.pathname === '/api/tg/webhook' && request.method === 'POST') {
      const update = await request.json().catch(() => null)
      if (update) ctx.waitUntil(handleTelegramUpdate(env, request, update))
      return new Response('ok', { status: 200 })
    }

    // ---------- Worker-to-worker sync (simple multi-account method) ----------
    // Authenticated by a shared secret header instead of the admin session
    // cookie, so another account's dashboard can call these directly. See
    // src/services/worker-sync.ts for the caller side.
    if (url.pathname.startsWith('/api/pool/') && request.method === 'POST' && env.DB) {
      const providedSecret = request.headers.get('X-Worker-Sync-Secret') || ''
      const ourSecret = await getOrCreateWorkerSyncSecret(env)
      // Constant-time compare (was a plain `===`) — the secret is the only
      // thing standing between "/api/pool/*" and anyone on the internet who
      // can guess it, so it shouldn't be comparable via a timing side-channel.
      const authorized = providedSecret.length > 0 && timingSafeEqual(providedSecret, ourSecret)
      if (!authorized) {
        return new Response(JSON.stringify({ ok: false, error: 'رمز اتصال ورکر اشتباه است' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/api/pool/ping') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      if (url.pathname === '/api/pool/sync-user') {
        const body = await request.json().catch(() => null)
        if (!body?.user?.uuid) return new Response(JSON.stringify({ ok: false, error: 'user نامعتبر' }), { status: 400 })
        await upsertSyncedUser(env, body.user)
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      if (url.pathname === '/api/pool/remove-user') {
        const body = await request.json().catch(() => null)
        if (!body?.uuid) return new Response(JSON.stringify({ ok: false, error: 'uuid نامعتبر' }), { status: 400 })
        await deleteSyncedUser(env, body.uuid)
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404 })
    }

    // ---------- Subscription routes ----------
    // The owner's personal subscription used to live at the fixed,
    // publicly-documented path "/sub" and served an HTML page meant for a
    // human to browse/copy from. That page is gone: this random path
    // (brand name + 4 random digits, e.g. "/bndmax7421", see
    // getOrCreateOwnerSubPath) now returns a plain-text subscription body in
    // the exact same format/headers handed to managed trial/pro users below
    // — i.e. it's meant to be pasted into a VPN client's "add subscription
    // by URL" field (v2rayNG, NekoBox, Hiddify, ...), not opened as a
    // webpage. The admin finds the current link in the dashboard's "نمای
    // کلی" tab and can regenerate it from there any time.
    if (env.DB) {
      const ownerSubPath = await getOrCreateOwnerSubPath(env)
      if (url.pathname.replace(/^\//, '') === ownerSubPath) {
        const ownerUuidList = splitAndFilter(env.UUID, ',')
        if (ownerUuidList.length === 0) {
          return new Response('یافت نشد', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        }
        const settings = await getAllSettings(env)
        const brand = settings.brand_name || 'BNDMAX VPN'
        const entries = ownerUuidList.map((uuid, i) => {
          const name = ownerUuidList.length > 1 ? `${brand} | مدیر ${i + 1}` : `${brand} | مدیر`
          return { name, link: generateSubscription(uuid, url, name) }
        })
        return new Response(buildSubscriptionText(entries), {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            // Same conventions as the managed-user sub below: clients
            // re-check every 12h on their own, and no `total=`/`expire=` in
            // Subscription-Userinfo is what every client reads as
            // "unlimited volume, never expires".
            'Profile-Update-Interval': '12',
            'Subscription-Userinfo': 'upload=0; download=0',
            'Content-Disposition': `attachment; filename="${ownerSubPath}.txt"`,
          },
        })
      }
    }

    // Owner (env.UUID) subscription-by-path, kept for backward compatibility
    const ownerUuids = splitAndFilter(env.UUID, ',')
    for (const uuid of ownerUuids) {
      if (url.pathname.includes(uuid)) {
        return new Response(generateSubscription(uuid, url), {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    }

    // Managed (trial/pro) users, delivered via Telegram bot with a personal link
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const uuidLike = pathSegments.find((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg),
    )
    if (uuidLike && env.DB) {
      const user = await getUserByUuid(env, uuidLike)
      if (user) {
        if (user.status !== 'active') {
          return new Response('این اشتراک منقضی یا غیرفعال شده است.', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
        // Each managed user gets a named config; active 'pro' users get 5
        // distinct configs, spread across the backend worker pool if one is
        // configured (requirements #2 and #4).
        const settings = await getAllSettings(env)
        const { activeHosts } = await getPoolRotation(env)
        // Requirement #5: if the admin has entered at least one confirmed
        // "healthy IP" and turned the toggle on (see the manually-entered
        // list in the "پنل‌ها" tab / db/queries.ts), every config's connect
        // address (`add=`) uses that IP:port instead of the worker's own
        // domain — `host=`/`sni=` still point at the real worker domain, so
        // this never breaks routing. When the toggle is off (default) or no
        // entries exist, getBestCleanIp returns null and configs fall back
        // to the worker's own domain on port 443, same as before this
        // feature existed.
        const cleanIpEntry = await getBestCleanIp(env)
        const cleanIpRows = await listCleanIps(env)
        const entries = buildUserSubscription(user, url, {
          brandName: settings.brand_name,
          adminUsername: settings.telegram_admin_username,
          poolHosts: activeHosts,
          proConfigName: settings.pro_config_name,
          trialConfigName: settings.trial_config_name,
          cleanIp: cleanIpEntry?.ip ?? null,
          cleanPort: cleanIpEntry?.port,
          extraCleanIps: cleanIpRows.map((row) => ({ ip: row.ip, port: row.port, country: row.country })),
        })

        // Requirement #2: v2rayNG / NekoBox / Hiddify / v2Box all read this
        // standard header (defined by the "subscription-userinfo" convention
        // most VLESS/V2Ray subscription servers follow) to show remaining
        // volume + expiry date right in the client's server list — it was
        // previously never sent, so clients had no way to display it at all.
        // upload is always 0 here since this project only tracks combined
        // usage; `total` is omitted entirely for unlimited (0 = no cap)
        // users, which every client treats as "unlimited" instead of "0 left".
        const usedBytes = Math.round((user.volume_used_mb || 0) * 1024 * 1024)
        const totalBytes = user.volume_limit_mb > 0 ? Math.round(user.volume_limit_mb * 1024 * 1024) : undefined
        const expireTs = user.expires_at ? Math.floor(user.expires_at / 1000) : undefined
        const userInfoParts = [`upload=0`, `download=${usedBytes}`]
        if (totalBytes !== undefined) userInfoParts.push(`total=${totalBytes}`)
        if (expireTs !== undefined) userInfoParts.push(`expire=${expireTs}`)

        return new Response(buildSubscriptionText(entries), {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            // Requirement #3: hint every subscription-aware client (v2rayN,
            // NekoBox, Shadowrocket, Hiddify, ...) to re-fetch this URL every
            // 12 hours on its own, so pool-rotation / config changes reach
            // the user automatically without them re-importing anything.
            'Profile-Update-Interval': '12',
            'Subscription-Userinfo': userInfoParts.join('; '),
            'Content-Disposition': `attachment; filename="${user.uuid}.txt"`,
          },
        })
      }
    }

    return new Response('یافت نشد', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (err) {
    console.error('Handler error:', err)
    return await errorPage()
  }
}
