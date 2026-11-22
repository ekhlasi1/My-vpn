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
// clean — this file finds the currently-clean ones automatically, by
// actually testing candidate IPs FROM this worker itself.
//
// How the test works: Workers' `fetch()` supports a Cloudflare-specific
// `cf.resolveOverride` option that forces the TCP connection to a specific
// IP while keeping the request's Host/SNI untouched — exactly the situation
// a client's `add=<ip>` + `host=/sni=<domain>` config recreates. We fetch
// `https://<own-domain>/cdn-cgi/trace` (a lightweight Cloudflare debug
// endpoint every zone/worker responds to) through each candidate IP and
// measure whether it succeeds and how long it took.

export interface CleanIpResult {
  ip: string
  healthy: boolean
  latencyMs: number | null
  error: string | null
}

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

const TEST_TIMEOUT_MS = 4000

/** Tests one candidate IP by dialing it directly while keeping SNI/Host on `domain`. */
async function testOneIp(domain: string, ip: string): Promise<CleanIpResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
    const res = await fetch(`https://${domain}/cdn-cgi/trace`, {
      method: 'GET',
      signal: controller.signal,
      // @ts-ignore -- Cloudflare Workers-specific fetch option, not in lib.dom types
      cf: { resolveOverride: ip },
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - start
    if (!res.ok) return { ip, healthy: false, latencyMs, error: `HTTP ${res.status}` }
    return { ip, healthy: true, latencyMs, error: null }
  } catch (err: any) {
    return { ip, healthy: false, latencyMs: Date.now() - start, error: err?.message || 'network error' }
  }
}

/**
 * Tests a slice of CANDIDATE_IPS (not all of them — Workers subrequest
 * limits and per-invocation CPU time make testing 60+ IPs in one pass risky)
 * against `domain`, in parallel. Called on a rotating offset from
 * handler.ts's dedicated clean-IP scan scheduler (see maybeRunCleanIpScan),
 * which now runs far more often than the general hourly maintenance job, so
 * the full candidate list gets re-verified within roughly an hour instead of
 * going stale for most of a day — important in a country doing active,
 * fast-changing IP-based blocking. batchSize=10 stays well under the ~50
 * subrequest ceiling on Workers free/paid plans even with a couple of other
 * subrequests happening in the same request.
 */
export async function discoverCleanIpsBatch(domain: string, offset: number, batchSize = 10): Promise<CleanIpResult[]> {
  const n = CANDIDATE_IPS.length
  const slice: string[] = []
  for (let i = 0; i < Math.min(batchSize, n); i++) {
    slice.push(CANDIDATE_IPS[(offset + i) % n])
  }
  return Promise.all(slice.map((ip) => testOneIp(domain, ip)))
}
