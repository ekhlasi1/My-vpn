import { errorPage, indexPage, subscriptionPage } from '../pages/index.ts'
import { setupPage, loginPage, dashboardPage } from '../pages/admin.ts'
import { generateSubscription } from '../services/subscription.ts'
import { processWebSocket } from '../network/websocket.ts'
import { splitAndFilter } from '../utils/array.ts'
import { handleAdminApi } from '../api/admin.ts'
import { handleTelegramUpdate } from '../telegram/bot.ts'
import { hasAdminPassword, getUserByUuid } from '../db/queries.ts'
import { requireAdmin } from '../auth/session.ts'

import type { Env } from './types.ts'

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
    const upgradeHeader = request.headers.get('Upgrade')

    // Handle WebSocket upgrade requests (the actual VLESS proxy tunnel)
    if (upgradeHeader && upgradeHeader === 'websocket') {
      return processWebSocket(request, env, ctx)
    }

    const url = new URL(request.url)

    // ---------- Admin dashboard ----------
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      const setupDone = await hasAdminPassword(env)
      if (!setupDone) return setupPage()
      const authed = await requireAdmin(request, env)
      if (!authed) return loginPage()
      return dashboardPage()
    }
    if (url.pathname === '/admin/login') {
      const setupDone = await hasAdminPassword(env)
      if (!setupDone) return setupPage()
      return loginPage()
    }
    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdminApi(request, env, url)
    }

    // ---------- Telegram webhook ----------
    if (url.pathname === '/api/tg/webhook' && request.method === 'POST') {
      const update = await request.json().catch(() => null)
      if (update) ctx.waitUntil(handleTelegramUpdate(env, request, update))
      return new Response('ok', { status: 200 })
    }

    // ---------- Subscription routes ----------
    if (url.pathname === '/sub') {
      return await subscriptionPage(env, request)
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
        return new Response(generateSubscription(uuidLike, url), {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    }

    // Serve main index page
    return await indexPage()
  } catch (err) {
    console.error('Handler error:', err)
    return await errorPage()
  }
}
