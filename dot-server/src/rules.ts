import { config } from './config.js'

export interface DnsRule {
  id: number
  kind: 'domain' | 'ip' | 'cidr'
  value: string
  note: string | null
  created_at: number
}

interface RuleSet {
  domains: string[] // lowercased; entries starting with '*.' match any subdomain
  ranges: { base: bigint; bits: number; family: 4 | 6 }[] // ip + cidr entries normalized together
  cleanIp: string | null
  fetchedAt: number
}

let current: RuleSet = { domains: [], ranges: [], cleanIp: config.fallbackCleanIp, fetchedAt: 0 }

function ipv4ToInt(ip: string): bigint {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`invalid IPv4 address: ${ip}`)
  }
  return (BigInt(parts[0]) << 24n) | (BigInt(parts[1]) << 16n) | (BigInt(parts[2]) << 8n) | BigInt(parts[3])
}

function ipv6ToBigInt(ip: string): bigint {
  // Minimal RFC 4291 "::" expansion — good enough for rule-list addresses,
  // not a general-purpose validator.
  const [head, tail] = ip.split('::')
  const headParts = head ? head.split(':') : []
  const tailParts = tail ? tail.split(':') : []
  const missing = 8 - headParts.length - tailParts.length
  const allParts = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts]
  if (allParts.length !== 8) throw new Error(`invalid IPv6 address: ${ip}`)
  return allParts.reduce((acc, part) => (acc << 16n) | BigInt(parseInt(part || '0', 16)), 0n)
}

function parseRange(value: string): { base: bigint; bits: number; family: 4 | 6 } {
  const isV6 = value.includes(':')
  const [addr, prefixStr] = value.split('/')
  const family: 4 | 6 = isV6 ? 6 : 4
  const totalBits = isV6 ? 128 : 32
  const bits = prefixStr !== undefined ? Number(prefixStr) : totalBits
  const base = isV6 ? ipv6ToBigInt(addr) : ipv4ToInt(addr)
  return { base, bits, family }
}

/** Fetches the current rules list + best clean IP from the worker's public API and swaps it in atomically. */
export async function refreshRules(): Promise<void> {
  const url = `${config.workerBaseUrl.replace(/\/$/, '')}/api/dns-rules`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  const data = (await res.json()) as { rules: DnsRule[]; cleanIp: string | null }

  const domains: string[] = []
  const ranges: RuleSet['ranges'] = []
  for (const r of data.rules) {
    if (r.kind === 'domain') {
      domains.push(r.value.toLowerCase().replace(/\.$/, ''))
    } else if (r.kind === 'ip') {
      try {
        ranges.push(parseRange(r.value))
      } catch {
        console.warn(`skipping invalid ip rule: ${r.value}`)
      }
    } else if (r.kind === 'cidr') {
      try {
        ranges.push(parseRange(r.value))
      } catch {
        console.warn(`skipping invalid cidr rule: ${r.value}`)
      }
    }
  }

  current = {
    domains,
    ranges,
    cleanIp: data.cleanIp || config.fallbackCleanIp,
    fetchedAt: Date.now(),
  }
  console.log(`[rules] refreshed: ${domains.length} domain rule(s), ${ranges.length} ip/cidr rule(s), cleanIp=${current.cleanIp ?? '(none yet)'}`)
}

/** Starts the periodic refresh loop. Call once at startup; first refresh happens immediately and blocks until done. */
export async function startRulesRefreshLoop(): Promise<void> {
  await refreshRules().catch((err) => console.error('[rules] initial fetch failed, starting with empty list:', err))
  setInterval(() => {
    refreshRules().catch((err) => console.error('[rules] refresh failed, keeping previous list:', err))
  }, config.rulesRefreshSeconds * 1000)
}

export function getCleanIp(): string | null {
  return current.cleanIp
}

export function domainMatches(name: string): boolean {
  const host = name.toLowerCase().replace(/\.$/, '')
  for (const d of current.domains) {
    if (d.startsWith('*.')) {
      const suffix = d.slice(1) // '.example.com'
      if (host === d.slice(2) || host.endsWith(suffix)) return true
    } else if (host === d) {
      return true
    }
  }
  return false
}

export function ipMatches(ip: string): boolean {
  try {
    const isV6 = ip.includes(':')
    const value = isV6 ? ipv6ToBigInt(ip) : ipv4ToInt(ip)
    const family: 4 | 6 = isV6 ? 6 : 4
    const totalBits = isV6 ? 128 : 32
    for (const r of current.ranges) {
      if (r.family !== family) continue
      const shift = BigInt(totalBits - r.bits)
      if ((value >> shift) === (r.base >> shift)) return true
    }
  } catch {
    // not a parseable literal IP (shouldn't happen for A/AAAA answer data) — treat as no match
  }
  return false
}
