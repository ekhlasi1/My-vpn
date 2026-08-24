// ==================== Automatic "clean IP" discovery (requirement #5) ====================
//
// Background: on a VLESS-over-WebSocket-over-TLS config that runs on a
// Cloudflare Worker, the address the client actually dials (`add=`) does NOT
// have to be the worker's own domain — Cloudflare's edge terminates TLS by
// SNI and then routes the HTTP/WS request by the `Host` header, regardless
// of which of Cloudflare's own anycast IPs was physically dialed. So as long
// as `host=`/`sni=` still name the real worker domain, `add=` can be any
// live Cloudflare edge IP. Some ranges/individual IPs get throttled or
// blocked by ISPs (in Iran, this is a moving target) while others stay
// clean — this file finds the currently-clean ones automatically.
//
// How the test works (v2 — see CHANGELOG): the first version of this file
// tested each candidate IP by dialing it directly FROM this Worker itself
// (Cloudflare's `cf.resolveOverride` fetch option). That only proves an IP
// is reachable from *inside Cloudflare's own network* — it says nothing
// about whether a real user's ISP can reach it, which produced exactly the
// "shows healthy here but doesn't actually work for users" symptom this
// project's operator ran into.
//
// This version instead asks a public, third-party network-probe service —
// check-host.net — to open a TCP connection to each candidate IP on port
// 443 *from its own nodes physically located inside Iran* (Tehran, Esfahan,
// Shiraz, Tabriz, Karaj — see IRAN_PROBE_NODES below) and reports back
// whether it succeeded. That's a real vantage point inside the country,
// instead of Cloudflare's network. One honest caveat: these probe nodes sit
// on general-purpose Iranian hosting/datacenter connectivity, not literally
// on a residential/mobile Irancell or Hamrah-e Aval IP block — so this is a
// much closer real-world signal than testing from Cloudflare, but it is
// still not a guarantee for every single mobile carrier and cell tower.
// check-host.net's API is public and documented at
// https://check-host.net/about/api — no API key required, but it is a
// shared third-party service, so requests are kept small and infrequent
// (see discoverCleanIpsBatch's batch size/interval) to stay a good citizen
// of it and avoid being rate-limited.

export interface CleanIpResult {
  ip: string
  healthy: boolean
  latencyMs: number | null
  error: string | null
}

/** check-host.net nodes physically located inside Iran (see check-host.net/about/api). */
const IRAN_PROBE_NODES = [
  'ir1.node.check-host.net', // Tehran
  'ir3.node.check-host.net', // Shiraz
  'ir4.node.check-host.net', // Tabriz
  'ir5.node.check-host.net', // Esfahan
  'ir6.node.check-host.net', // Karaj
]

/**
 * Candidate Cloudflare anycast IPs to test, spread across several of
 * Cloudflare's published ranges (104.16/13, 104.24/14, 172.64/13,
 * 188.114.96/20) so a block on one range doesn't zero out every candidate.
 * This list intentionally isn't exhaustive — it's a rotating sample tested a
 * few at a time on a schedule (see discoverCleanIpsBatch below); the point
 * is to keep discovering which of Cloudflare's many edge IPs are currently
 * unblocked, not to hardcode a "best" IP permanently (that list goes stale
 * within days on a country doing active IP-based blocking).
 */
export const CANDIDATE_IPS: string[] = [
  '104.16.0.0', '104.16.1.0', '104.16.2.0', '104.16.123.0', '104.16.200.0',
  '104.17.0.0', '104.17.1.0', '104.18.0.0', '104.19.0.0', '104.20.0.0',
  '104.21.0.0', '104.22.0.0', '104.24.0.0', '104.24.100.0', '104.25.0.0',
  '104.26.0.0', '104.27.0.0', '104.28.0.0',
  '172.64.0.0', '172.64.32.0', '172.64.64.0', '172.64.100.0', '172.64.150.0',
  '172.65.0.0', '172.66.0.0', '172.67.0.0', '172.67.50.0', '172.67.100.0',
  '172.67.150.0', '172.67.200.0', '172.68.0.0', '172.69.0.0', '172.70.0.0',
  '188.114.96.0', '188.114.97.0', '188.114.98.0', '188.114.99.0',
  // Additional published Cloudflare anycast ranges (see
  // https://www.cloudflare.com/ips/) — spreading candidates across more
  // ranges means an ISP-level block on any single range still leaves
  // plenty of other candidates to discover as healthy.
  '103.21.244.0', '103.21.245.0', '103.21.246.0',
  '103.22.200.0', '103.22.201.0', '103.22.202.0',
  '103.31.4.0', '103.31.5.0', '103.31.6.0',
  '108.162.192.0', '108.162.200.0', '108.162.210.0', '108.162.220.0',
  '131.0.72.0', '131.0.73.0',
  '141.101.64.0', '141.101.80.0', '141.101.100.0', '141.101.120.0',
  '162.158.0.0', '162.158.50.0', '162.158.100.0', '162.158.150.0', '162.158.200.0',
  '173.245.48.0', '173.245.58.0',
  '190.93.240.0', '190.93.245.0', '190.93.250.0',
  '197.234.240.0', '197.234.241.0',
  '198.41.128.0', '198.41.200.0',
]

const REQUEST_TIMEOUT_MS = 8000
// check-host.net runs the check asynchronously on its own nodes; this is how
// long we give it to finish before polling for a result. Short enough to
// stay well inside a single scheduled batch, long enough that a TCP check
// from Iran to a Cloudflare edge IP has time to actually complete.
const RESULT_POLL_DELAY_MS = 5000
const RESULT_POLL_RETRIES = 3
const RESULT_POLL_INTERVAL_MS = 3000

interface CheckHostInitResponse {
  ok?: number
  request_id?: string
}

// check-host.net's check-result payload, per node, is either `null` (still
// pending) or an array of attempts. For a `tcp` check each attempt is
// `[success, timeSeconds]` on success or `[success]`/`[success, error]` on
// failure, where success is 1 or 0.
type CheckHostResultMap = Record<string, Array<[number, ...unknown[]]> | null>

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tests one candidate IP by asking check-host.net to open a TCP connection
 * to it on port 443 from each of IRAN_PROBE_NODES. `domain` is unused here
 * (kept only so the exported function signature below doesn't change for
 * its callers) — the test dials the IP directly, it doesn't go through the
 * worker's own domain at all.
 */
async function testOneIpViaCheckHost(ip: string): Promise<CleanIpResult> {
  const nodeParams = IRAN_PROBE_NODES.map((n) => `node=${encodeURIComponent(n)}`).join('&')
  const initUrl = `https://check-host.net/check-tcp?host=${encodeURIComponent(ip)}:443&${nodeParams}`

  const init = await fetchJson<CheckHostInitResponse>(initUrl)
  if (!init?.ok || !init.request_id) {
    return { ip, healthy: false, latencyMs: null, error: 'check-host.net init failed' }
  }

  const resultUrl = `https://check-host.net/check-result/${init.request_id}`
  let results: CheckHostResultMap | null = null
  await new Promise((r) => setTimeout(r, RESULT_POLL_DELAY_MS))
  for (let attempt = 0; attempt < RESULT_POLL_RETRIES; attempt++) {
    results = await fetchJson<CheckHostResultMap>(resultUrl)
    const pending = results ? Object.values(results).some((v) => v === null) : true
    if (results && !pending) break
    await new Promise((r) => setTimeout(r, RESULT_POLL_INTERVAL_MS))
  }
  if (!results) return { ip, healthy: false, latencyMs: null, error: 'check-host.net result timed out' }

  const latencies: number[] = []
  let successCount = 0
  let reportedCount = 0
  for (const nodeResult of Object.values(results)) {
    if (!nodeResult || nodeResult.length === 0) continue
    reportedCount++
    const [success, time] = nodeResult[0]
    if (success === 1) {
      successCount++
      if (typeof time === 'number') latencies.push(time * 1000)
    }
  }

  if (reportedCount === 0) return { ip, healthy: false, latencyMs: null, error: 'no Iranian nodes reported' }

  // Require a majority of the Iranian nodes that responded to succeed, not
  // just one — a single node's result can be noisy.
  const healthy = successCount / reportedCount >= 0.5
  const latencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null
  const error = healthy ? null : `reachable from ${successCount}/${reportedCount} Iranian nodes`
  return { ip, healthy, latencyMs, error }
}

/**
 * Tests a slice of CANDIDATE_IPS (not all of them — check-host.net is a
 * shared public service, and each IP's check takes several seconds to
 * resolve) against Iranian probe nodes, in parallel. Called on a rotating
 * offset from handler.ts's dedicated clean-IP scan scheduler (see
 * maybeRunCleanIpScan), so the full candidate list gets re-verified on a
 * rolling basis. `domain` is accepted for backward compatibility with
 * existing callers but is unused — see testOneIpViaCheckHost.
 */
export async function discoverCleanIpsBatch(domain: string, offset: number, batchSize = 5): Promise<CleanIpResult[]> {
  void domain
  const n = CANDIDATE_IPS.length
  const slice: string[] = []
  for (let i = 0; i < Math.min(batchSize, n); i++) {
    slice.push(CANDIDATE_IPS[(offset + i) % n])
  }
  return Promise.all(slice.map((ip) => testOneIpViaCheckHost(ip)))
}
