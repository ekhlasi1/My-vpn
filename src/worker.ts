import { handleRequest } from './core/handler'
import { runScheduledMaintenance } from './cron/tasks'
import type { Env } from './core/types'

/**
 * BNDMAX VPN Worker - Main entry point
 * VLESS proxy server + admin dashboard + Telegram bot, running on Cloudflare Workers
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx)
    } catch (err) {
      // Safety net: never let Cloudflare show an opaque "Error 1101". Show the
      // real error name/message instead (no stack, no secrets) and log it.
      console.error('Unhandled worker error:', err)
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      return new Response(`Worker error\n${msg.slice(0, 500)}\n\nمسیر /health و لاگ زندهٔ ورکر را بررسی کنید.`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runScheduledMaintenance(env))
  },
} satisfies ExportedHandler<Env>
