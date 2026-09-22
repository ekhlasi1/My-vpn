import { connect } from 'cloudflare:sockets'

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
    const mask = Number(maskStr)
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || mask < 16 || mask > 32) return null
    const octets = ip.split('.').map(Number)
    if (octets.some((n) => n < 0 || n > 255)) return null
    const base = (((octets[0] << 24) >>> 0) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
    const hostBits = 32 - mask
    const size = 2 ** hostBits
    const network = hostBits === 32 ? 0 : (base & (0xffffffff << hostBits)) >>> 0
    const value = (network + Math.floor(Math.random() * size)) >>> 0
    return `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`
  } catch { return null }
}

async function findSingleIp(ranges: string[], ports: number[], sni: string): Promise<VahidScanHit | null> {
  for (let i = 0; i < FIND_ATTEMPTS; i++) {
    const range = ranges[Math.floor(Math.random() * ranges.length)]
    const ip = getRandomIP(range)
    if (!ip) continue
    const open = await checkOpenPorts(ip, ports, sni)
    if (open.length) {
      open.sort((a, b) => a.ping - b.ping)
      const best = open[0]
      return { success: true, ip, port: best.port, ping: best.ping, country: null }
    }
  }
  return null
}

export async function runVahidScanRound(
  ports: number[] = DEFAULT_SCANNER_PORTS,
  sni = 'localhost',
): Promise<VahidScanHit[]> {
  const validPorts = ports.filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
  const scanPorts = validPorts.length ? validPorts : DEFAULT_SCANNER_PORTS
  const cfResponse = await fetch('https://www.cloudflare.com/ips-v4')
  if (!cfResponse.ok) throw new Error(`دریافت رنج‌های Cloudflare ناموفق بود (${cfResponse.status})`)
  const ranges = (await cfResponse.text()).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const settled = await Promise.allSettled(
    Array(FINDERS_PER_ROUND).fill(null).map(() => findSingleIp(ranges, scanPorts, sni)),
  )
  const seen = new Set<string>()
  return settled
    .filter((r): r is PromiseFulfilledResult<VahidScanHit> => r.status === 'fulfilled' && r.value != null)
    .map((r) => r.value)
    .filter((r) => { const k = `${r.ip}:${r.port}`; if (seen.has(k)) return false; seen.add(k); return true })
}
