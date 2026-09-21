import type { Env } from '../core/types'
import {
  getAllSettings,
  setSettings,
  hasAdminPassword,
  getSetting,
  listUsers,
  getUserStats,
  createUser,
  updateUser,
  deleteUser,
  listBotUsers,
  getQuotaStatus,
  setServicePaused,
  addPoolWorker,
  removePoolWorker,
  setPoolWorkerEnabled,
  updatePoolWorker,
  checkAndStorePoolWorkerHealth,
  getPoolRotation,
  getOrCreateWorkerSyncSecret,
  regenerateWorkerSyncSecret,
  getOrCreateOwnerSubPath,
  regenerateOwnerSubPath,
  getPoolWorker,
  backfillAllUsersToPoolWorker,
  resyncAllUsersToAllAccounts,
  listCleanIps,
  addCleanIp,
  addCleanIps,
  deleteCleanIp,
  listDnsRules,
  addDnsRule,
  deleteDnsRule,
  getUserByUuid,
  getBestCleanIp,
} from '../db/queries'
import { scanSocks4, scanSni, scanCandidates, expandCidr, sniHandshake, SNI_PORTS, MAX_CANDIDATE_JOBS } from '../services/ip-scanner'
import { runVahidScanRound } from '../services/vahid-scanner'
import type { CandidateInput } from '../services/ip-scanner'
import { hashPassword, verifyPassword } from '../auth/password'
import { createAdminSession, sessionCookieHeader, clearSessionCookieHeader, requireAdmin, logoutAdmin } from '../auth/session'
import { setWebhook, sendMessage, setMyCommands } from '../telegram/api'
import { buildUserSubscription } from '../services/subscription'

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/admin/, '') || '/'
  const method = request.method

  // ---- Public (no session required) ----
  if (path === '/setup' && method === 'POST') {
    if (await hasAdminPassword(env)) return json({ error: 'قبلاً راه‌اندازی شده' }, 400)
    const { password } = await readJson(request)
    if (!password || password.length < 6) return json({ error: 'رمز باید حداقل ۶ کاراکتر باشد' }, 400)
    await setSettings(env, { admin_password_hash: await hashPassword(password) })
    const token = await createAdminSession(env)
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) })
  }

  if (path === '/login' && method === 'POST') {
    const { password } = await readJson(request)
    const hash = await getSetting(env, 'admin_password_hash')
    if (!hash || !(await verifyPassword(password || '', hash))) {
      return json({ error: 'رمز عبور اشتباه است' }, 401)
    }
    const token = await createAdminSession(env)
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) })
  }

  if (path === '/logout' && method === 'POST') {
    await logoutAdmin(request, env)
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() })
  }

  // ---- Everything below requires a valid session ----
  const authed = await requireAdmin(request, env)
  if (!authed) return json({ error: 'unauthorized' }, 401)

  if (path === '/stats' && method === 'GET') {
    // Do not fetch thousands of user rows merely to calculate six counters.
    // Aggregate in D1 so the overview remains fast and reliable as the user
    // table grows.
    return json(await getUserStats(env))
  }

  if (path === '/users' && method === 'GET') {
    const users = await listUsers(env, 1000)
    return json({ users })
  }

  // Requirement #1: every account that ever messaged the bot, listed on the site.
  if (path === '/bot-users' && method === 'GET') {
    const botUsers = await listBotUsers(env, 1000)
    return json({ botUsers })
  }

  if (path === '/users/pro' && method === 'POST') {
    const { telegramId, telegramName, days, volumeGb } = await readJson(request)
    if (!days || !volumeGb) return json({ error: 'مقادیر روز و حجم الزامی است' }, 400)
    const uuid = crypto.randomUUID()
    const now = Date.now()
    await createUser(env, {
      uuid,
      telegram_id: telegramId || null,
      telegram_name: telegramName || telegramId || null,
      type: 'pro',
      status: 'active',
      volume_limit_mb: Number(volumeGb) * 1024,
      volume_used_mb: 0,
      created_at: now,
      expires_at: now + Number(days) * 24 * 60 * 60 * 1000,
      warned_80: 0,
    })

    if (telegramId) {
      const token = await getSetting(env, 'telegram_bot_token')
      if (token) {
        // Requirement #3: send ONE auto-updating subscription link, not raw
        // pasted configs — see subscriptionUrl()'s twin in telegram/bot.ts.
        const subLink = `${url.origin}/${uuid}`
        await sendMessage(
          token,
          telegramId,
          `🎖️ <b>اشتراک VIP شما فعال شد!</b>\n\n⏳ مدت: ${days} روز\n📦 حجم: ${volumeGb} گیگابایت\n\n` +
            `🔗 لینک اشتراک شما (۵ کانفیگ داخل همین یک لینک — به‌عنوان subscription وارد اپلیکیشن کنید، هر ۱۲ ساعت خودکار بروزرسانی می‌شود):\n<code>${subLink}</code>`,
        )
      }
    }
    return json({ ok: true, uuid })
  }

  const userMatch = path.match(/^\/users\/([^/]+)(\/extend)?$/)
  if (userMatch && (method === 'PATCH' || method === 'DELETE' || (method === 'POST' && userMatch[2]))) {
    const uuid = decodeURIComponent(userMatch[1])
    if (method === 'DELETE') {
      await deleteUser(env, uuid)
      return json({ ok: true })
    }
    if (userMatch[2]) {
      const { days } = await readJson(request)
      const extendMs = (Number(days) || 30) * 24 * 60 * 60 * 1000
      const users = await listUsers(env, 1000)
      const user = users.find((u) => u.uuid === uuid)
      const base = user?.expires_at && user.expires_at > Date.now() ? user.expires_at : Date.now()
      await updateUser(env, uuid, { expires_at: base + extendMs, status: 'active' })
      return json({ ok: true })
    }
    const body = await readJson(request)
    const allowed: Record<string, unknown> = {}
    for (const k of ['status', 'note', 'volume_limit_mb']) {
      if (body[k] !== undefined) allowed[k] = body[k]
    }
    await updateUser(env, uuid, allowed)
    return json({ ok: true })
  }

  // ---- Configs handed to a managed user — same generator the public
  // subscription link uses, exposed here so the admin can view/copy them
  // and ping-test each one without leaving the dashboard. ----
  const userConfigsMatch = path.match(/^\/users\/([^/]+)\/configs$/)
  if (userConfigsMatch && method === 'GET') {
    const uuid = decodeURIComponent(userConfigsMatch[1])
    const user = await getUserByUuid(env, uuid)
    if (!user) return json({ error: 'کاربر پیدا نشد' }, 404)

    const settings = await getAllSettings(env)
    const { activeHosts } = await getPoolRotation(env)
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
    // Parse each generated vless:// link back into its dial target so the
    // dashboard's ping test doesn't need its own URI parser.
    const entriesWithTarget = entries.map((e) => {
      let address = url.hostname
      let port = 443
      let sni = url.hostname
      try {
        const parsed = new URL(e.link.replace(/^vless:/, 'https:'))
        address = parsed.hostname
        port = Number(parsed.port) || 443
        sni = parsed.searchParams.get('sni') || address
      } catch {
        // fall back to the worker's own host — link stays usable either way
      }
      return { ...e, address, port, sni }
    })
    return json({
      ok: true,
      subscriptionUrl: `${url.origin}/${uuid}`,
      user: { uuid: user.uuid, type: user.type, status: user.status, telegram_name: user.telegram_name },
      entries: entriesWithTarget,
    })
  }

  // ---- Ping-test a single config link from the "کانفیگ‌های کاربر" viewer ----
  // Reuses the same real TLS/SNI handshake the clean-IP scanner uses (not a
  // browser-side fetch, which can't dial an arbitrary port or set an SNI
  // different from the URL host) so the result reflects the config's actual
  // dialed address/port/SNI, exactly as a VLESS client would open it.
  if (path === '/config-ping' && method === 'POST') {
    const { address, port, sni } = await readJson(request)
    if (!address || !String(address).trim()) return json({ error: 'آدرس الزامی است' }, 400)
    const portNum = Number(port) || 443
    const result = await sniHandshake(String(address).trim(), portNum, String(sni || address).trim())
    return json({ ok: true, result })
  }

  if (path === '/settings' && method === 'GET') {
    const settings = await getAllSettings(env)
    delete (settings as any).admin_password_hash
    return json(settings)
  }

  if (path === '/settings' && method === 'POST') {
    const body = await readJson(request)
    const allowedKeys = [
      'trial_duration_hours',
      'trial_volume_mb',
      'trial_cooldown_hours',
      'telegram_bot_token',
      'telegram_admin_id',
      'telegram_admin_username',
      'brand_name',
      'usage_notify_step_mb',
      'required_channel',
      'required_channel_url',
      'wiki_gift_link',
      'pro_config_name',
      'trial_config_name',
      'clean_ip_override_enabled',
    ]
    const toSave: Record<string, string> = {}
    for (const k of allowedKeys) {
      if (body[k] !== undefined) toSave[k] = String(body[k])
    }
    await setSettings(env, toSave)
    return json({ ok: true })
  }

  // ---- Requirement #3: daily quota + kill switch ----
  if (path === '/quota' && method === 'GET') {
    const status = await getQuotaStatus(env)
    return json(status)
  }

  if (path === '/quota' && method === 'POST') {
    const { dailyLimit, autoPause } = await readJson(request)
    const toSave: Record<string, string> = {}
    if (dailyLimit !== undefined) toSave.daily_request_limit = String(Number(dailyLimit) || 90000)
    if (autoPause !== undefined) toSave.auto_pause_at_limit = autoPause ? '1' : '0'
    await setSettings(env, toSave)
    return json({ ok: true })
  }

  if (path === '/quota/pause' && method === 'POST') {
    await setServicePaused(env, true)
    return json({ ok: true })
  }

  if (path === '/quota/resume' && method === 'POST') {
    await setServicePaused(env, false)
    return json({ ok: true })
  }

  // ---- Requirement #4: backend worker pool ----
  if (path === '/pool' && method === 'GET') {
    const { pool } = await getPoolRotation(env)
    const settings = await getAllSettings(env)
    return json({ pool, batchSize: settings.pool_batch_size, restDays: settings.pool_rest_days })
  }

  if (path === '/pool' && method === 'POST') {
    const { url: workerUrl, label, syncSecret, cfAccountId, cfApiToken, cfDatabaseId, cfScriptName, country } = await readJson(request)
    if (!workerUrl) return json({ error: 'آدرس ورکر الزامی است' }, 400)
    await addPoolWorker(env, {
      url: String(workerUrl).trim(),
      label: label ? String(label) : null,
      sync_secret: syncSecret ? String(syncSecret).trim() : null,
      cf_account_id: cfAccountId ? String(cfAccountId).trim() : null,
      cf_api_token: cfApiToken ? String(cfApiToken).trim() : null,
      cf_database_id: cfDatabaseId ? String(cfDatabaseId).trim() : null,
      cf_script_name: cfScriptName ? String(cfScriptName).trim() : null,
      country: country ? String(country).trim() : null,
    })
    return json({ ok: true })
  }

  // ---- Simple worker-to-worker sync: this worker's own secret (requirement: easier multi-account setup) ----
  if (path === '/sync-secret' && method === 'GET') {
    const secret = await getOrCreateWorkerSyncSecret(env)
    return json({ secret })
  }

  if (path === '/sync-secret/regenerate' && method === 'POST') {
    const secret = await regenerateWorkerSyncSecret(env)
    return json({ secret })
  }

  // ---- Owner's personal subscription link (random path replacing the old fixed "/sub") ----
  if (path === '/owner-sub' && method === 'GET') {
    const ownerSubPath = await getOrCreateOwnerSubPath(env)
    return json({ path: ownerSubPath, link: `${url.protocol}//${url.host}/${ownerSubPath}` })
  }

  if (path === '/owner-sub/regenerate' && method === 'POST') {
    const ownerSubPath = await regenerateOwnerSubPath(env)
    return json({ path: ownerSubPath, link: `${url.protocol}//${url.host}/${ownerSubPath}` })
  }

  if (path === '/pool/settings' && method === 'POST') {
    const { batchSize, restDays } = await readJson(request)
    const toSave: Record<string, string> = {}
    if (batchSize !== undefined) toSave.pool_batch_size = String(Math.max(1, Number(batchSize) || 5))
    if (restDays !== undefined) toSave.pool_rest_days = String(Math.max(1, Number(restDays) || 1))
    await setSettings(env, toSave)
    return json({ ok: true })
  }

  const poolMatch = path.match(/^\/pool\/(\d+)$/)
  if (poolMatch && (method === 'PATCH' || method === 'DELETE')) {
    const id = Number(poolMatch[1])
    if (method === 'DELETE') {
      await removePoolWorker(env, id)
      return json({ ok: true })
    }
    const body = await readJson(request)
    if (body.enabled !== undefined && Object.keys(body).length === 1) {
      await setPoolWorkerEnabled(env, id, !!body.enabled)
      return json({ ok: true })
    }
    // Full edit of an account's stored fields (label + Cloudflare credentials).
    const allowed: Record<string, unknown> = {}
    if (body.url !== undefined) allowed.url = String(body.url).trim()
    if (body.label !== undefined) allowed.label = body.label ? String(body.label) : null
    if (body.syncSecret !== undefined) allowed.sync_secret = body.syncSecret ? String(body.syncSecret).trim() : null
    if (body.cfAccountId !== undefined) allowed.cf_account_id = body.cfAccountId ? String(body.cfAccountId).trim() : null
    if (body.cfApiToken !== undefined) allowed.cf_api_token = body.cfApiToken ? String(body.cfApiToken).trim() : null
    if (body.cfDatabaseId !== undefined) allowed.cf_database_id = body.cfDatabaseId ? String(body.cfDatabaseId).trim() : null
    if (body.cfScriptName !== undefined) allowed.cf_script_name = body.cfScriptName ? String(body.cfScriptName).trim() : null
    if (body.country !== undefined) allowed.country = body.country ? String(body.country).trim() : null
    if (body.enabled !== undefined) allowed.enabled = body.enabled ? 1 : 0
    await updatePoolWorker(env, id, allowed as any)
    // If credentials/secret were just filled in (or the URL changed), the
    // account may have gone from "can't sync" to "can sync" — or now points
    // somewhere with an empty users table. Re-run the same backfill used
    // when the account is first added so it doesn't silently stay empty
    // until the next full user create/renew. See addPoolWorker in queries.ts
    // for why this matters.
    const row = await getPoolWorker(env, id)
    if (row) await backfillAllUsersToPoolWorker(env, row).catch((err) => console.error('backfill after edit failed:', err))
    return json({ ok: true })
  }

  // ---- Requirement #1 (3rd batch): per-account Cloudflare health check ----
  if (path.match(/^\/pool\/(\d+)\/check$/) && method === 'POST') {
    const id = Number(path.match(/^\/pool\/(\d+)\/check$/)![1])
    const row = await checkAndStorePoolWorkerHealth(env, id)
    if (!row) return json({ error: 'اکانت پیدا نشد' }, 404)
    return json({ ok: true, account: row })
  }

  if (path === '/pool/check-all' && method === 'POST') {
    const { pool } = await getPoolRotation(env)
    const results = await Promise.all(pool.map((w) => checkAndStorePoolWorkerHealth(env, w.id)))
    return json({ ok: true, accounts: results.filter(Boolean) })
  }

  // Manual "sync every existing user to every configured account, right
  // now" — the fix for configs that stopped working after a new account was
  // connected to the pool (see backfillAllUsersToPoolWorker in queries.ts).
  if (path === '/pool/resync-all-users' && method === 'POST') {
    const results = await resyncAllUsersToAllAccounts(env)
    return json({ ok: true, results })
  }

  // ---- Requirement #5: manually-entered "healthy IP" list (no scanning) ----
  if (path === '/clean-ips' && method === 'GET') {
    const ips = await listCleanIps(env)
    return json({ ips })
  }

  if (path === '/clean-ips' && method === 'POST') {
    const { ip, port, note, country } = await readJson(request)
    if (!ip || !String(ip).trim()) return json({ error: 'آی‌پی الزامی است' }, 400)
    const portNum = Number(port) || 443
    if (portNum < 1 || portNum > 65535) return json({ error: 'پورت نامعتبر است' }, 400)
    await addCleanIp(env, String(ip).trim(), portNum, note ? String(note) : null, country ? String(country) : null)
    const ips = await listCleanIps(env)
    return json({ ok: true, ips })
  }

  // Bulk variant used by the Radar/manual-scan "add selected" button: the
  // dashboard already narrowed things down to the top 15 healthy-by-ping
  // rows and the admin ticked which ones to keep, so this just inserts
  // each one (addCleanIp enforces the MAX_CLEAN_IPS=15 cap, oldest evicted
  // first, on every call — see db/queries.ts).
  if (path === '/clean-ips/bulk' && method === 'POST') {
    const { items } = await readJson(request)
    if (!Array.isArray(items) || !items.length) return json({ error: 'هیچ آی‌پی‌ای انتخاب نشده' }, 400)
    const added = await addCleanIps(
      env,
      items.map((it: Record<string, unknown>) => ({
        ip: String(it?.ip ?? ''),
        port: Number(it?.port) || 443,
        note: it?.note ? String(it.note) : null,
        country: it?.country ? String(it.country) : null,
      })),
    )
    const ips = await listCleanIps(env)
    return json({ ok: true, added, ips })
  }

  // Rows coming from src/data/rented-clean-ips.ts have an id like "file:0" —
  // they're not in D1 at all, so there's nothing to delete; edit that file
  // and redeploy instead.
  if (path.match(/^\/clean-ips\/file:\d+$/) && method === 'DELETE') {
    return json({ error: 'این ردیف از فایل src/data/rented-clean-ips.ts می‌آید؛ برای تغییر/حذف آن فایل را ویرایش و دوباره دیپلوی کنید.' }, 400)
  }

  const cleanIpMatch = path.match(/^\/clean-ips\/(\d+)$/)
  if (cleanIpMatch && method === 'DELETE') {
    await deleteCleanIp(env, Number(cleanIpMatch[1]))
    const ips = await listCleanIps(env)
    return json({ ok: true, ips })
  }

  // ---- In-panel clean-IP scanner (replaces the old local clean-ip-scanner/server.py) ----
  // Fully automatic: no Cloudflare API token or manually-typed domain needed —
  // this code already runs as part of the deployed worker, so its own SNI is
  // just the hostname the admin is browsing the dashboard on right now.
  // Every ip:port tested comes from the admin's own healthy-IP list
  // (listCleanIps: D1 + src/data/rented-clean-ips.ts) — never anything scraped
  // or entered ad hoc, matching the old tool's "owned servers only" scope.
  if (path === '/clean-ips/scan' && method === 'POST') {
    const { mode, ids } = await readJson(request)
    if (mode !== 'socks4' && mode !== 'sni') {
      return json({ error: 'mode باید socks4 یا sni باشد' }, 400)
    }
    const all = await listCleanIps(env)
    const idSet = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null
    // Carry each row's existing (admin-entered) country tag into the scan so the
    // result can echo it back — the scan never invents/detects a country itself,
    // it only forwards the label the row already had.
    const targets = (idSet ? all.filter((row) => idSet.has(String(row.id))) : all).map((row) => ({ ip: row.ip, port: row.port, country: row.country }))
    if (!targets.length) return json({ error: 'هیچ آی‌پی‌ای در لیست برای اسکن وجود ندارد' }, 400)

    if (mode === 'socks4') {
      const results = await scanSocks4(targets)
      return json({ ok: true, mode, results })
    }
    const sni = url.hostname
    const results = await scanSni(targets, sni)
    return json({ ok: true, mode, sni, results })
  }

  // ---- Discover new clean IPs from an ad-hoc pasted candidate list ----
  // Unlike /clean-ips/scan above (which only re-tests rows already saved),
  // this accepts raw candidates the admin pastes in right now (one
  // "ip", "ip:port" or "ip,port,country" per line), validates + dedups them,
  // and runs the same real TLS/SNI handshake against THIS worker's own
  // domain. Every address tested is one the admin explicitly supplied —
  // nothing is fetched, scraped, or guessed server-side.
  if (path === '/clean-ips/scan-candidates' && method === 'POST') {
    const body = await readJson(request)
    const rawLines: string[] = Array.isArray(body?.candidates)
      ? body.candidates.map((x: unknown) => String(x))
      : String(body?.candidates || '').split(/\r?\n/)

    // Accepts, per line: "1.2.3.4" | "1.2.3.4:443" | "1.2.3.4,443,DE" |
    // "1.2.3.4:443,DE" | "1.2.3.0/24" | "1.2.3.0/24,443,DE" — a CIDR block
    // (up to /16) is expanded into individual candidates that all share
    // that line's port/country. The full candidate list is re-parsed from
    // `body.candidates` on every page (see `offset` below) — cheap (just
    // building arrays of strings) and keeps this endpoint stateless, which
    // matters more than the small repeated-parsing cost across pages.
    const candidates: CandidateInput[] = []
    const MAX_RAW_CANDIDATES = 100000 // safety cap on expanded-candidate count, independent of the ip×port job/page size below
    for (const rawLine of rawLines) {
      if (candidates.length >= MAX_RAW_CANDIDATES) break
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      const parts = line.split(',').map((s) => s.trim())
      let head = parts[0] || ''
      let portStr: string | null = null
      let country: string | null = null

      if (head.includes(':')) {
        const [h, p] = head.split(':')
        head = h || ''
        portStr = p || null
        country = parts[1] || null
      } else if (parts[1] && /^\d+$/.test(parts[1])) {
        portStr = parts[1]
        country = parts[2] || null
      } else {
        country = parts[1] || null
      }
      const port = portStr ? Number(portStr) : null
      const validPort = port && Number.isFinite(port) ? port : null

      if (head.includes('/')) {
        let expanded: string[] | null
        try {
          expanded = expandCidr(head)
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, 400)
        }
        if (expanded) {
          for (const ip of expanded) {
            if (candidates.length >= MAX_RAW_CANDIDATES) break
            candidates.push({ ip, port: validPort, country })
          }
          continue
        }
      }

      if (!head) continue
      candidates.push({ ip: head, port: validPort, country })
    }
    if (!candidates.length) {
      return json({ error: 'هیچ آی‌پی یا رنج معتبری در متن وارد شده پیدا نشد' }, 400)
    }

    let ports: number[] = []
    if (Array.isArray(body?.ports)) {
      ports = body.ports.map((p: unknown) => Number(p)).filter((p: number) => Number.isInteger(p) && p >= 1 && p <= 65535)
    }
    if (!ports.length) ports = SNI_PORTS

    const defaultCountry = body?.country ? String(body.country).trim() : null
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0
    const sni = url.hostname
    const { results, totalJobs, nextOffset } = await scanCandidates(candidates, sni, { ports, defaultCountry, offset })
    if (!results.length && offset === 0) {
      return json({ error: 'هیچ آی‌پی معتبری (IPv4) در متن وارد شده پیدا نشد' }, 400)
    }
    return json({
      ok: true,
      sni,
      results,
      totalJobs,
      scannedSoFar: offset + results.length,
      nextOffset,
      pageSize: MAX_CANDIDATE_JOBS,
    })
  }

  // ---- "اسکنر وحید" (Vahid Scanner) ----
  // Runs one round of the admin-supplied reference scanner (see
  // src/services/vahid-scanner.ts — algorithm ported verbatim, untouched).
  // Entirely admin-triggered: the dashboard calls this repeatedly (Start
  // button) to accumulate results, exactly like Radar/manual-scan already do
  // for their own scanners; nothing here runs on page load or on a timer.
  if (path === '/vahid-scan/round' && method === 'POST') {
    const body = await readJson(request).catch(() => ({}))
    const ports = Array.isArray(body?.ports) ? body.ports.map((p: unknown) => Number(p)) : undefined
    const results = await runVahidScanRound(ports)
    return json({ ok: true, results })
  }

  // ---- Public DNS routing list (Private DNS / DoT feature) ----
  // Read is also exposed WITHOUT auth at GET /api/dns-rules (see
  // core/handler.ts) for the standalone dot-server to consume; these three
  // stay under /api/admin/* and require a session because they write.
  if (path === '/dns-rules' && method === 'GET') {
    const rules = await listDnsRules(env)
    return json({ rules })
  }

  if (path === '/dns-rules' && method === 'POST') {
    const { kind, value, note } = await readJson(request)
    if (!['domain', 'ip', 'cidr'].includes(kind)) return json({ error: 'نوع نامعتبر است' }, 400)
    if (!value || !String(value).trim()) return json({ error: 'مقدار الزامی است' }, 400)
    await addDnsRule(env, kind, String(value).trim(), note ? String(note) : null)
    const rules = await listDnsRules(env)
    return json({ ok: true, rules })
  }

  const dnsRuleMatch = path.match(/^\/dns-rules\/(\d+)$/)
  if (dnsRuleMatch && method === 'DELETE') {
    await deleteDnsRule(env, Number(dnsRuleMatch[1]))
    const rules = await listDnsRules(env)
    return json({ ok: true, rules })
  }

  if (path === '/telegram/set-webhook' && method === 'POST') {
    const token = await getSetting(env, 'telegram_bot_token')
    if (!token) return json({ ok: false, error: 'ابتدا توکن ربات را ذخیره کنید' }, 400)
    const webhookUrl = `${url.origin}/api/tg/webhook`
    const result = await setWebhook(token, webhookUrl)
    // Requirement #5: register the ☰ command menu shown in Telegram clients.
    await setMyCommands(token, [
      { command: 'start', description: '🎁 دریافت اشتراک تست' },
      { command: 'usage', description: '📊 وضعیت مصرف من' },
      { command: 'pro', description: '🎖️ خرید اشتراک VIP' },
      { command: 'wikigift', description: '🎁 جایزه ماهانه ویژه VIP' },
      { command: 'help', description: 'ℹ️ راهنما' },
    ])
    return json({ ok: !!result?.ok, result })
  }

  if (path === '/change-password' && method === 'POST') {
    const { currentPassword, newPassword } = await readJson(request)
    const hash = await getSetting(env, 'admin_password_hash')
    if (!hash || !(await verifyPassword(currentPassword || '', hash))) {
      return json({ error: 'رمز فعلی اشتباه است' }, 401)
    }
    if (!newPassword || newPassword.length < 6) return json({ error: 'رمز جدید باید حداقل ۶ کاراکتر باشد' }, 400)
    await setSettings(env, { admin_password_hash: await hashPassword(newPassword) })
    return json({ ok: true })
  }

  return json({ error: 'not found' }, 404)
}
