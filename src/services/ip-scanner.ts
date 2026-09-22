// ==================== In-panel Clean-IP / rented-proxy scanner ====================
//
// This replaces the old `clean-ip-scanner/server.py` local tool: instead of the
// admin running a separate Python server on their own machine and pasting a
// Cloudflare API token into it, the exact same two checks now run *inside this
// Worker* and are triggered from a button in the "🌐 آی‌پی‌های سالم" tab.
//
// Two modes, matching the old tool exactly:
//  - "socks4": connects to one of YOUR entries in the healthy-IP list (D1 +
//    src/data/rented-clean-ips.ts, via listCleanIps()) and performs a real
//    SOCKS4 CONNECT handshake toward a fixed test target, just to prove the
//    proxy itself is alive and measure its ping.
//  - "sni": performs a real TLS handshake straight to that same ip:port, but
//    presents THIS worker's own domain as the SNI (via Socket.startTls's
//    `expectedServerHostname`) on each of Cloudflare's TLS ports, then sends a
//    plain HTTP GET and checks for a valid HTTP response. This is the
//    "clean IP" check: it tells you whether that address can actually reach
//    your worker over a given port/SNI combination.
//
// No Cloudflare API token and no external server are needed anymore: because
// this code runs as part of the deployed worker, the SNI it needs is simply
// the hostname of the incoming admin request (the worker's own domain) —
// there is nothing left to "detect".
//
// Nothing here ever contacts a third party for a list of addresses — it only
// ever tests the ip:port pairs already present in the admin's own healthy-IP
// list, exactly like the old local tool only ever read proxy/*.txt.

import { connect } from 'cloudflare:sockets'

export interface ScanTarget {
  ip: string
  port: number
  /** Cosmetic country tag copied from the source clean_ips/rented-clean-ips.ts
   *  row this target came from (see countries.ts) — never guessed from the
   *  scan itself, since Workers can't detect an exit country. */
  country?: string | null
}

export interface ScanResult {
  ip: string
  port: number
  success: boolean
  ping?: number
  error?: string
  /** Echoes ScanTarget.country so the dashboard can pre-fill the flag when
   *  adding a healthy result back to the list, instead of asking the admin
   *  to re-pick a country it already told us about. */
  country?: string | null
}

export type ScanMode = 'socks4' | 'sni'

/** Same TLS ports Cloudflare terminates on, and that the subscription/config generator assumes. */
export const SNI_PORTS: number[] = [443, 2053, 2083, 2087, 2096, 8443]

const HANDSHAKE_TIMEOUT_MS = 7000
const SCAN_CONCURRENCY = 10

// Fixed CONNECT target used only to measure the proxy's own health/ping —
// mirrors TEST_TARGET_HOST/PORT in the old server.py exactly.
const SOCKS4_TEST_TARGET = { ip: '1.1.1.1', port: 80 }

function timeoutRejection<T>(ms: number, label: string): Promise<T> {
  return new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(label)), ms)
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([promise, timeoutRejection<T>(ms, label)])
}

function ipv4ToBytes(ip: string): Uint8Array {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error('این آدرس IPv4 معتبر نیست (اسکنر فعلاً فقط IPv4 را پشتیبانی می‌کند)')
  }
  return Uint8Array.from(parts)
}

async function closeQuietly(socket: Socket | undefined): Promise<void> {
  if (!socket) return
  try {
    await socket.close()
  } catch {
    // already closed/errored — nothing to do
  }
}

/** Real SOCKS4 handshake against one of the admin's own rented proxy servers. Only measures health/ping. */
export async function socks4Handshake(ip: string, port: number): Promise<ScanResult> {
  const start = Date.now()
  let socket: Socket | undefined
  try {
    socket = connect({ hostname: ip, port })
    await withTimeout(socket.opened, HANDSHAKE_TIMEOUT_MS, 'اتصال زمان‌بر شد (timeout)')

    const writer = socket.writable.getWriter()
    const reader = socket.readable.getReader()
    try {
      // SOCKS4 CONNECT request: VN=4, CD=1(CONNECT), DSTPORT (2B big-endian),
      // DSTIP (4B), USERID (empty) + NULL terminator.
      const packet = new Uint8Array(9)
      packet[0] = 0x04
      packet[1] = 0x01
      packet[2] = (SOCKS4_TEST_TARGET.port >> 8) & 0xff
      packet[3] = SOCKS4_TEST_TARGET.port & 0xff
      packet.set(ipv4ToBytes(SOCKS4_TEST_TARGET.ip), 4)
      packet[8] = 0x00

      await writer.write(packet)
      const { value, done } = await withTimeout(reader.read(), HANDSHAKE_TIMEOUT_MS, 'پاسخی از پروکسی دریافت نشد (timeout)')
      const ping = Date.now() - start

      if (done || !value || value.length < 2) {
        return { ip, port, success: false, error: 'پاسخ ناقص از سرور' }
      }
      if (value[0] === 0x00 && value[1] === 0x5a) {
        return { ip, port, success: true, ping }
      }
      return { ip, port, success: false, error: `SOCKS4 رد شد (کد ${value[1] ?? '؟'})` }
    } finally {
      writer.releaseLock()
      reader.releaseLock()
    }
  } catch (err) {
    return { ip, port, success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await closeQuietly(socket)
  }
}

/**
 * Real TLS handshake to ip:port with `sni` as the presented SNI/Host — the
 * exact "clean IP" mechanism: the TCP connection goes to `ip`, but Cloudflare
 * routes the request by SNI/Host, so this only ever reaches YOUR OWN worker
 * (never a third party), and only tells you whether that ip:port combination
 * is currently a usable path *to your own deployment*.
 *
 * Success is "the TLS handshake completed and at least one byte came back",
 * not "the response parses as a plain HTTP/1.1 status line". That stricter
 * check used to be the pass/fail condition here and was the main cause of
 * genuinely-working IPs being reported as unhealthy: Cloudflare's edge can
 * (depending on ALPN negotiation, which this low-level Socket API doesn't
 * let us pin to http/1.1) reply over HTTP/2 framing instead of a text status
 * line, or the first `read()` can return a partial chunk that hasn't reached
 * the status line yet — either way the byte string wouldn't start with
 * "HTTP/1." even though the path is completely healthy. Getting any response
 * at all after a completed TLS handshake is already proof the address
 * reaches this worker; that's the only thing a VLESS/WS client cares about
 * too, since it never sends a plain GET / like this probe does.
 */
export async function sniHandshake(ip: string, port: number, sni: string): Promise<ScanResult> {
  const start = Date.now()
  let plainSocket: Socket | undefined
  let tlsSocket: Socket | undefined
  try {
    plainSocket = connect({ hostname: ip, port }, { secureTransport: 'starttls' })
    await withTimeout(plainSocket.opened, HANDSHAKE_TIMEOUT_MS, 'اتصال زمان‌بر شد (timeout)')
    tlsSocket = plainSocket.startTls({ expectedServerHostname: sni })

    const writer = tlsSocket.writable.getWriter()
    const reader = tlsSocket.readable.getReader()
    try {
      const req = `GET / HTTP/1.1\r\nHost: ${sni}\r\nUser-Agent: clean-ip-scanner\r\nConnection: close\r\n\r\n`
      await writer.write(new TextEncoder().encode(req))

      const { value, done } = await withTimeout(reader.read(), HANDSHAKE_TIMEOUT_MS, 'پاسخی دریافت نشد (timeout)')
      const ping = Date.now() - start

      if (done || !value || value.length === 0) {
        return { ip, port, success: false, error: 'پاسخی دریافت نشد' }
      }
      // Any bytes back over a completed TLS handshake = the path is alive.
      return { ip, port, success: true, ping }
    } finally {
      writer.releaseLock()
      reader.releaseLock()
    }
  } catch (err) {
    return { ip, port, success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await closeQuietly(tlsSocket)
    await closeQuietly(plainSocket)
  }
}

/**
 * Same check, but retried once on a transient failure before giving up.
 * Used for bulk scans (scanSni/scanCandidates) where a single cold/slow
 * first attempt (Cloudflare spinning up a route to a rarely-used edge IP,
 * a one-off dropped packet, etc.) shouldn't be enough to brand an address
 * "unhealthy" — this is the other main source of good IPs being reported
 * as dead. Left out of the single ad-hoc config-ping button (that one stays
 * a single attempt) so a manual click still returns fast.
 */
async function sniHandshakeReliable(ip: string, port: number, sni: string): Promise<ScanResult> {
  const first = await sniHandshake(ip, port, sni)
  if (first.success) return first
  return sniHandshake(ip, port, sni)
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++
      if (i >= items.length) return
      const item = items[i]
      if (item === undefined) return
      results[i] = await fn(item)
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

function sortResults(results: ScanResult[]): ScanResult[] {
  return [...results].sort((a, b) => {
    if (a.success !== b.success) return a.success ? -1 : 1
    return (a.ping ?? 999999) - (b.ping ?? 999999)
  })
}

/** Runs the SOCKS4 health check against every given target (one result each). */
export async function scanSocks4(targets: ScanTarget[]): Promise<ScanResult[]> {
  const results = await mapWithConcurrency(targets, SCAN_CONCURRENCY, async (t) => ({
    ...(await socks4Handshake(t.ip, t.port)),
    country: t.country ?? null,
  }))
  return sortResults(results)
}

/** Runs the SNI/TLS check against every given target on every port in SNI_PORTS. */
export async function scanSni(targets: ScanTarget[], sni: string): Promise<ScanResult[]> {
  const jobs: ScanTarget[] = []
  for (const t of targets) {
    for (const port of SNI_PORTS) jobs.push({ ip: t.ip, port, country: t.country })
  }
  const results = await mapWithConcurrency(jobs, SCAN_CONCURRENCY, async (j) => ({
    ...(await sniHandshakeReliable(j.ip, j.port, sni)),
    country: j.country ?? null,
  }))
  return sortResults(results)
}

export function isValidIpv4(ip: string): boolean {
  try {
    ipv4ToBytes(ip)
    return true
  } catch {
    return false
  }
}

/** Largest CIDR prefix length accepted per line (i.e. the biggest range
 *  allowed) — /16 = 65,536 addresses. Expanding this is cheap (it's just
 *  building a JS array); the real ceiling is how many ip×port combinations
 *  a single Worker invocation can dial, which is handled separately by
 *  chunking (see MAX_CANDIDATE_JOBS / scanCandidates' offset param) rather
 *  than by rejecting large ranges outright. This limit exists only to catch
 *  obvious mistakes (e.g. pasting a /8). */
const MIN_CIDR_PREFIX = 16

/**
 * Expands "a.b.c.d/nn" into its individual host addresses (network + broadcast
 * excluded for /24..'/31, kept as-is for /32). Returns null if the string
 * isn't CIDR notation, and throws a descriptive Persian error if it IS CIDR
 * notation but the prefix is wider than MIN_CIDR_PREFIX (range too large to
 * scan safely in one go).
 */
export function expandCidr(value: string): string[] | null {
  const match = value.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/)
  if (!match) return null
  const [, base, prefixStr] = match
  const prefix = Number(prefixStr)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('پیشوند CIDR نامعتبر است (باید بین 0 تا 32 باشد)')
  }
  if (prefix < MIN_CIDR_PREFIX) {
    throw new Error(
      `رنج «${value}» خیلی بزرگ است — برای جلوگیری از timeout روی ورکر، فقط رنج‌های /${MIN_CIDR_PREFIX} یا کوچک‌تر ` +
      `(حداکثر ${2 ** (32 - MIN_CIDR_PREFIX)} آی‌پی) پشتیبانی می‌شود. رنج بزرگ‌تر را به چند تکه‌ی /${MIN_CIDR_PREFIX} تقسیم کنید.`,
    )
  }
  const baseBytes = ipv4ToBytes(base)
  const baseInt = (baseBytes[0]! << 24) | (baseBytes[1]! << 16) | (baseBytes[2]! << 8) | baseBytes[3]!
  const hostBits = 32 - prefix
  const size = 2 ** hostBits
  const networkInt = (baseInt & (size === 4294967296 ? 0 : ~(size - 1))) >>> 0
  const ips: string[] = []
  // Exclude network (.0) and broadcast (.255)-equivalent addresses for
  // ranges that actually have them (/24..'/30) — for /31 and /32 keep all.
  const skipEdges = hostBits >= 2
  for (let i = 0; i < size; i++) {
    if (skipEdges && (i === 0 || i === size - 1)) continue
    const n = (networkInt + i) >>> 0
    ips.push([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.'))
  }
  return ips
}

/** How many ip×port jobs one single backend call (one Worker invocation) is
 *  willing to dial. This used to be a hard cap that silently *dropped*
 *  anything past the first 400 jobs, which is why pasting more than that
 *  quietly scanned only a fraction of what the admin gave it. It's now just
 *  the size of one page: scanCandidates() takes an `offset`, and the
 *  dashboard calls it repeatedly (see admin.ts) advancing the offset — with
 *  a short pause between calls (also so bursts of connect() calls don't look
 *  like abuse to Cloudflare/the target IPs) — until every job has actually
 *  been scanned, no matter how large the pasted range list is. Kept modest
 *  (well under Cloudflare Workers' per-request subrequest ceiling) so each
 *  individual page reliably finishes inside one invocation. */
export const MAX_CANDIDATE_JOBS = 300

export interface CandidateInput {
  ip: string
  /** Explicit port for this one candidate, if the admin supplied "ip:port". */
  port?: number | null
  /** Country tag for this one candidate, if the admin supplied one per-line. */
  country?: string | null
}

export interface CandidateScanOptions {
  /** Ports to try for candidates that didn't specify their own port. */
  ports: number[]
  /** Country tag to apply to candidates that didn't specify their own. */
  defaultCountry?: string | null
  /** Job index to start this page at (0-based) — see MAX_CANDIDATE_JOBS. */
  offset?: number
}

/**
 * "Discover clean IPs" scan: unlike scanSni/scanSocks4 above (which only ever
 * re-test rows already saved in the admin's own healthy-IP list), this takes
 * a fresh, ad-hoc batch of ip (or CIDR-range) candidates the admin pastes in
 * right now — e.g. copied from a community "Germany clean IP" list — and
 * performs the exact same real TLS handshake against THIS worker's own
 * domain (via SNI) to see which ones actually reach it. Nothing is fetched
 * or guessed on the server side; every ip:port tested comes from something
 * the admin explicitly supplied (a single address or a CIDR range they
 * typed in).
 *
 * Scans one page of up to MAX_CANDIDATE_JOBS ip×port jobs starting at
 * `options.offset` (default 0) and reports `totalJobs` (the full count
 * after expanding every candidate/CIDR × port) and `nextOffset` (where the
 * next page should start, or null once this was the last page) so the
 * caller can keep paging until the entire list has actually been scanned.
 */
export async function scanCandidates(
  candidates: CandidateInput[],
  sni: string,
  options: CandidateScanOptions,
): Promise<{ results: ScanResult[]; totalJobs: number; nextOffset: number | null }> {
  const ports = options.ports.length ? options.ports : SNI_PORTS
  const seen = new Set<string>()
  const jobs: ScanTarget[] = []
  for (const c of candidates) {
    const ip = String(c.ip || '').trim()
    if (!ip || !isValidIpv4(ip)) continue
    const country = (c.country && String(c.country).trim()) || options.defaultCountry || null
    const jobPorts = c.port ? [c.port] : ports
    for (const port of jobPorts) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue
      const key = ip + ':' + port
      if (seen.has(key)) continue
      seen.add(key)
      jobs.push({ ip, port, country })
    }
  }
  const offset = Math.max(0, Math.floor(options.offset || 0))
  const page = jobs.slice(offset, offset + MAX_CANDIDATE_JOBS)
  const results = await mapWithConcurrency(page, SCAN_CONCURRENCY, async (j) => ({
    ...(await sniHandshakeReliable(j.ip, j.port, sni)),
    country: j.country ?? null,
  }))
  const nextOffset = offset + page.length < jobs.length ? offset + page.length : null
  return { results: sortResults(results), totalJobs: jobs.length, nextOffset }
}
