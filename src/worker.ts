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
    return handleRequest(request, env, ctx)
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runScheduledMaintenance(env))
  },
} satisfies ExportedHandler<Env>
