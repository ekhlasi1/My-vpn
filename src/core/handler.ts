// NOTE: indexPage() (the public marketing landing page) is intentionally kept
// but no longer routed at "/" — see requirement #7. It's still reachable at
// "/landing" below for forks that want it back as the default root.
import { errorPage, indexPage, subscriptionPage } from '../pages/index.ts'
import { dbMissingPage, dbErrorPage } from '../pages/system.ts'
import { setupPage, loginPage, dashboardPage } from '../pages/admin.ts'
import { generateSubscription, buildUserSubscription, buildSubscriptionBody, subscriptionHeaders } from '../services/subscription.ts'
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
  listDnsRules,
  runCleanIpDiscovery,
} from '../db/queries.ts'
import { requireAdmin } from '../auth/session.ts'
import { ensureDatabase, databaseStatus, DbMissingError } from '../db/bootstrap.ts'
import { runScheduledMaintenance } from '../cron/tasks.ts'

import type { Env } from './types.ts'

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000 // hourly, same cadence as the old cron trigger

// Clean-IP discovery used to only run once per hourly maintenance pass (see
// maybeRunMaintenance below), 10 IPs at a time out of 60+ candidates — a
// full re-verification cycle took most of a day, so a range that got newly
// blocked by an ISP could keep being served as "clean" for hours. Running it
// on its own much shorter cycle means the whole candidate list gets
// re-checked roughly every hour instead, which is what actually fixes
// "sometimes the IP doesn't ping" for a country doing fast-moving IP-based
// blocking. Kept fully separate from maybeRunMaintenance (own timestamp key,
// own guard) so a slow/failed discovery pass never delays quota/expiry
// processing and vice versa.
const CLEAN_IP_SCAN_INTERVAL_MS = 10 * 60 * 1000 // every 10 minutes

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

/** Same self-scheduling pattern as maybeRunMaintenance, but on its own much
 * shorter interval and limited to clean-IP discovery — see
 * CLEAN_IP_SCAN_INTERVAL_MS above for why this needs to run independently. */
function maybeRunCleanIpScan(env: Env, ctx: ExecutionContext, domain: string): void {
  if (!env.DB) return
  ctx.waitUntil(
    (async () => {
      try {
        const lastRunStr = await getSetting(env, 'last_clean_ip_scan')
        const lastRun = parseFloat(lastRunStr) || 0
        if (Date.now() - lastRun < CLEAN_IP_SCAN_INTERVAL_MS) return
        await setSetting(env, 'last_clean_ip_scan', String(Date.now()))
        await runCleanIpDiscovery(env, domain)
      } catch (err) {
        console.error('maybeRunCleanIpScan failed:', err)
      }
    })(),
  )
}

function jsonResponse(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when a browser (not a VPN client) is asking for the page. */
function wantsHtml(request: Request): boolean {
  return (request.headers.get('Accept') || '').includes('text/html')
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
  const url = new URL(request.url)
  const isApi = url.pathname.startsWith('/api/')

  // Makes sure the D1 schema exists (idempotent, once per isolate) and kicks
  // off the self-scheduled background jobs. Throws DbMissingError when the
  // DB binding itself is not attached.
  const needDb = async (): Promise<void> => {
    await ensureDatabase(env)
    maybeRunMaintenance(env, ctx, url.hostname)
    maybeRunCleanIpScan(env, ctx, url.hostname)
  }

  try {
    // ---------- WebSocket upgrade: the actual VLESS proxy tunnel ----------
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
      // Daily request cap + manual kill switch. It must never take the tunnel
      // down because of a database problem, so any failure here fails OPEN.
      if (env.DB) {
        try {
          await ensureDatabase(env)
          const quota = await checkAndIncrementQuota(env)
          if (!quota.allowed) {
            return new Response('سرویس موقتاً متوقف شده است. لطفاً بعداً تلاش کنید.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          }
        } catch (err) {
          console.error('quota check skipped:', err)
        }
      }
      return processWebSocket(request, env, ctx)
    }

    // ---------- Health check (no secrets, safe to expose) ----------
    if (url.pathname === '/health') {
      const db = await databaseStatus(env)
      return jsonResponse(
        {
          ok: db.ready,
          db,
          config: {
            uuidConfigured: splitAndFilter(env.UUID || '', ',').length > 0,
            proxyIpConfigured: splitAndFilter(env.PROXY_IP || '', ',').length > 0,
          },
          time: new Date().toISOString(),
        },
        db.ready ? 200 : 503,
      )
    }

    // ---------- Root / admin: setup, login, dashboard ----------
    // The public marketing page (indexPage) stays in the codebase at "/landing";
    // the admin login/dashboard is served at "/" exactly like "/admin".
    if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/') {
      await needDb()
      const setupDone = await hasAdminPassword(env)
      if (!setupDone) return setupPage()
      const authed = await requireAdmin(request, env)
      if (!authed) return loginPage()
      return dashboardPage()
    }

    if (url.pathname === '/landing') {
      return await indexPage()
    }
    if (url.pathname === '/admin/login') {
      await needDb()
      const setupDone = await hasAdminPassword(env)
      if (!setupDone) return setupPage()
      return loginPage()
    }
    if (url.pathname.startsWith('/api/admin/')) {
      await needDb()
      return await handleAdminApi(request, env, url)
    }

    // ---------- Worker-native DNS-over-HTTPS ----------
    if (url.pathname === '/dns-query' && (request.method === 'GET' || request.method === 'POST' || request.method === 'OPTIONS')) {
      if (request.method !== 'OPTIONS') await needDb()
      return handleDohRequest(request, env)
    }

    // ---------- Public DNS routing list (used by the standalone DoT server) ----------
    if (url.pathname === '/api/dns-rules' && request.method === 'GET') {
      if (!env.DB) {
        return jsonResponse({ rules: [], cleanIp: null }, 200, { 'Access-Control-Allow-Origin': '*' })
      }
      await needDb()
      const [rules, cleanIp] = await Promise.all([listDnsRules(env), getBestCleanIp(env)])
      return new Response(JSON.stringify({ rules, cleanIp }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
      })
    }

    // ---------- Telegram webhook ----------
    if (url.pathname === '/api/tg/webhook' && request.method === 'POST') {
      const update = await request.json().catch(() => null)
      if (update) {
        try {
          await needDb()
          ctx.waitUntil(handleTelegramUpdate(env, request, update))
        } catch (err) {
          // Always answer 200 so Telegram doesn't hammer us with retries.
          console.error('telegram update dropped:', err)
        }
      }
      return new Response('ok', { status: 200 })
    }

    // ---------- Worker-to-worker sync ----------
    if (url.pathname.startsWith('/api/pool/') && request.method === 'POST' && env.DB) {
      await needDb()
      const providedSecret = request.headers.get('X-Worker-Sync-Secret') || ''
      const ourSecret = await getOrCreateWorkerSyncSecret(env)
      const authorized = providedSecret.length > 0 && providedSecret === ourSecret
      if (!authorized) {
        return jsonResponse({ ok: false, error: 'رمز اتصال ورکر اشتباه است' }, 401)
      }

      if (url.pathname === '/api/pool/ping') {
        return jsonResponse({ ok: true })
      }

      if (url.pathname === '/api/pool/sync-user') {
        const body: any = await request.json().catch(() => null)
        if (!body?.user?.uuid) return jsonResponse({ ok: false, error: 'user نامعتبر' }, 400)
        await upsertSyncedUser(env, body.user)
        return jsonResponse({ ok: true })
      }

      if (url.pathname === '/api/pool/remove-user') {
        const body: any = await request.json().catch(() => null)
        if (!body?.uuid) return jsonResponse({ ok: false, error: 'uuid نامعتبر' }, 400)
        await deleteSyncedUser(env, body.uuid)
        return jsonResponse({ ok: true })
      }

      return jsonResponse({ ok: false, error: 'not found' }, 404)
    }

    // ---------- Subscription: /sub ----------
    // Browsers get the copy-paste page. VPN clients (v2rayN, v2rayNG, Hiddify,
    // NekoBox, ...) import the same URL as a subscription and need the
    // standard base64 list instead of HTML.
    if (url.pathname === '/sub') {
      const raw = url.searchParams.get('raw') === '1' || url.searchParams.get('format') === 'base64'
      if (wantsHtml(request) && !raw) {
        return await subscriptionPage(env, request)
      }
      const owner = splitAndFilter(env.UUID || '', ',').map((u) => u.trim())
      if (owner.length === 0) {
        return new Response('UUID is not configured', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }
      const entries = owner.map((uuid, i) => ({
        link: generateSubscription(uuid, url, owner.length > 1 ? `${url.hostname}-${i + 1}` : undefined),
      }))
      return new Response(buildSubscriptionBody(entries), {
        status: 200,
        headers: subscriptionHeaders(url.hostname),
      })
    }

    // ---------- Owner (env.UUID) subscription-by-path ----------
    const ownerUuids = splitAndFilter(env.UUID || '', ',').map((u) => u.trim()).filter(Boolean)
    const lowerPath = url.pathname.toLowerCase()
    for (const uuid of ownerUuids) {
      if (lowerPath.includes(uuid.toLowerCase())) {
        return new Response(buildSubscriptionBody([{ link: generateSubscription(uuid, url) }]), {
          status: 200,
          headers: subscriptionHeaders(url.hostname),
        })
      }
    }

    // ---------- Managed (trial/pro) users: personal link /<uuid> ----------
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const uuidLike = pathSegments.find((seg) => UUID_RE.test(seg))
    if (uuidLike && env.DB) {
      await needDb()
      const user = await getUserByUuid(env, uuidLike.toLowerCase())
      if (user) {
        if (user.status !== 'active') {
          return new Response('این اشتراک منقضی یا غیرفعال شده است.', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
        // Trial users get one config; active 'pro' users get 5, spread across
        // the backend worker pool when one is configured.
        const settings = await getAllSettings(env)
        const { activeHosts } = await getPoolRotation(env)
        // NOTE: intentionally NOT passing a `cleanIp` override. The auto-discovered
        // IP is only verified from inside Cloudflare's own network, so it says
        // nothing about reachability from a user's ISP.
        const entries = buildUserSubscription(user, url, {
          brandName: settings.brand_name,
          adminUsername: settings.telegram_admin_username,
          poolHosts: activeHosts,
          proConfigName: settings.pro_config_name,
          trialConfigName: settings.trial_config_name,
        })

        // "subscription-userinfo" is the de-facto header that v2rayNG / NekoBox /
        // Hiddify / v2Box read to show remaining volume + expiry. `total` is
        // omitted for unlimited users (0 would be shown as "0 left").
        const usedBytes = Math.round((user.volume_used_mb || 0) * 1024 * 1024)
        const totalBytes = user.volume_limit_mb > 0 ? Math.round(user.volume_limit_mb * 1024 * 1024) : undefined
        const expireTs = user.expires_at ? Math.floor(user.expires_at / 1000) : undefined
        const userInfoParts = [`upload=0`, `download=${usedBytes}`]
        if (totalBytes !== undefined) userInfoParts.push(`total=${totalBytes}`)
        if (expireTs !== undefined) userInfoParts.push(`expire=${expireTs}`)

        return new Response(buildSubscriptionBody(entries), {
          status: 200,
          headers: subscriptionHeaders(settings.brand_name || 'BNDMAX VPN', {
            'Subscription-Userinfo': userInfoParts.join('; '),
            'Content-Disposition': `attachment; filename="${user.uuid}.txt"`,
          }),
        })
      }
    }

    return new Response('یافت نشد', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (err) {
    console.error('Handler error:', err)
    if (isApi) {
      return jsonResponse(
        { error: err instanceof DbMissingError ? 'دیتابیس D1 به ورکر متصل نیست' : 'خطای داخلی سرور' },
        500,
      )
    }
    if (err instanceof DbMissingError) return dbMissingPage()
    const message = err instanceof Error ? err.message : String(err)
    if (/D1_|no such (table|column)|SQLITE|database/i.test(message)) return dbErrorPage()
    return await errorPage()
  }
}
