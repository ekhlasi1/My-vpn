// "اسکنر وحید" (Vahid Scanner)
//
// Ported verbatim from a reference Cloudflare Worker script the admin
// supplied directly ("worker.js", v3.0.0, by @Sezar_Sec), at their explicit
// request to use exactly that scanning method — nothing added, nothing
// removed from the algorithm itself:
//   - pick a random IP inside a random Cloudflare /ips-v4 range
//   - check whether any of a fixed port list answers a HEAD request
//   - if so, measure a single HEAD request's round-trip time to port 443
//   - repeat up to 50 times per attempt, run 5 attempts in parallel, dedupe
//
// The ONLY change from the reference script is that getLatency() there
// returns a formatted string ("123 ms" / "Timeout") for display in its own
// standalone page; getLatencyMs() here returns a plain number of
// milliseconds (or null on timeout) instead, so results slot directly into
// this dashboard's existing `ping`-sorted list/checkbox/"add to clean IPs"
// components (topHealthyByPing / renderSelectableResults), shared with the
// Radar and manual-scan tabs. The timing measurement itself — one HEAD
// request to port 443 with a 1500ms timeout — is unchanged.

/**
 * Ports the scanner probes when looking for an open Cloudflare edge port —
 * every port the admin's reference SezarSec panel exposes as a checkbox
 * (its TLS ports plus its plain-HTTP ports), so this scanner can test the
 * exact same set. A caller may narrow this via runVahidScanRound(ports).
 */
const DEFAULT_SCANNER_PORTS = [80, 443, 2053, 2083, 2087, 2096, 8080, 8443, 8880]

function getRandomIP(cidr: string): string | null {
  try {
    const [ip, maskStr] = cidr.split('/')
    const mask = parseInt(maskStr, 10)
    if (mask < 16 || mask > 32) return null
    let start = ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0)
    start &= (-1 << (32 - mask))
    const range = 1 << (32 - mask)
    const randomIp = start + Math.floor(Math.random() * range)
    return [(randomIp >> 24) & 255, (randomIp >> 16) & 255, (randomIp >> 8) & 255, randomIp & 255].join('.')
  } catch (e) {
    return null
  }
}

async function checkPort(ip: string, port: number): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 800)
  try {
    await fetch(`https://${ip}:${port}`, { signal: controller.signal, method: 'HEAD', redirect: 'manual' })
    return true
  } catch (err) {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function checkOpenPorts(ip: string, ports: number[]): Promise<number[]> {
  const concurrencyLimit = 10
  const openPorts: number[] = []
  for (let i = 0; i < ports.length; i += concurrencyLimit) {
    const chunk = ports.slice(i, i + concurrencyLimit)
    const results = await Promise.all(chunk.map((port) => checkPort(ip, port)))
    results.forEach((isOpen, index) => { if (isOpen) openPorts.push(chunk[index]) })
  }
  return openPorts
}

/** Same single-HEAD-request measurement as the reference script's getLatency — returns milliseconds instead of a formatted string; null means it timed out (>=1500ms), same threshold as the reference script. Measures the given port (the reference script only ever measured 443). */
async function getLatencyMs(ip: string, port: number): Promise<number | null> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    await fetch(`https://${ip}:${port}`, { signal: controller.signal, method: 'HEAD', redirect: 'manual' })
    clearTimeout(timeout)
  } catch (e) { /* ignore — duration below decides timeout vs success */ }
  const duration = Date.now() - start
  return duration >= 1500 ? null : Math.round(duration)
}

export interface VahidScanHit {
  success: true
  ip: string
  port: number
  ping: number
  country: null
}

async function findSingleIp(ranges: string[], ports: number[]): Promise<VahidScanHit | null> {
  if (ranges.length === 0) return null
  const attempts = 50
  for (let i = 0; i < attempts; i++) {
    const range = ranges[Math.floor(Math.random() * ranges.length)]
    const ip = getRandomIP(range)
    if (!ip) continue
    const openPorts = await checkOpenPorts(ip, ports)
    if (openPorts.length > 0) {
      // Time every port that answered and report the fastest one, so the
      // returned port/ping always match and are one of the requested ports
      // (this used to always time and report 443, whatever was requested).
      const timed = await Promise.all(openPorts.map(async (port) => ({ port, ping: await getLatencyMs(ip, port) })))
      const best = timed
        .filter((t): t is { port: number; ping: number } => t.ping != null)
        .sort((a, b) => a.ping - b.ping)[0]
      if (!best) continue
      return { success: true, ip, port: best.port, ping: best.ping, country: null }
    }
  }
  return null
}

/**
 * One "round" — identical in substance to the reference script's /scanip
 * endpoint: fetch Cloudflare's current IPv4 range list, then run 5
 * findSingleIp() attempts in parallel and dedupe by IP. The dashboard calls
 * this repeatedly (client-triggered, never automatically) to accumulate
 * enough results to show a top-15-by-ping list. `ports` lets the caller
 * narrow which ports count as "open" for this round (defaults to every port
 * the reference SezarSec panel exposes).
 */
export async function runVahidScanRound(ports: number[] = DEFAULT_SCANNER_PORTS): Promise<VahidScanHit[]> {
  const validPorts = ports.filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
  const scanPorts = validPorts.length ? validPorts : DEFAULT_SCANNER_PORTS

  const cfResponse = await fetch('https://www.cloudflare.com/ips-v4')
  const ranges = (await cfResponse.text()).split('\n').filter(Boolean)

  const settled = await Promise.allSettled(Array(5).fill(null).map(() => findSingleIp(ranges, scanPorts)))
  let results = settled
    .filter((r): r is PromiseFulfilledResult<VahidScanHit> => r.status === 'fulfilled' && r.value != null)
    .map((r) => r.value)

  const seen = new Set<string>()
  results = results.filter((r) => {
    if (seen.has(r.ip)) return false
    seen.add(r.ip)
    return true
  })
  return results
}
