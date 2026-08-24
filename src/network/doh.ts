import type { Env } from '../core/types'
import { listDnsRules, getBestCleanIp } from '../db/queries'

/**
 * Worker-native DNS-over-HTTPS (RFC 8484) endpoint, mounted at GET/POST
 * `/dns-query` by src/core/handler.ts.
 *
 * This is a SEPARATE feature from the DoT server in ../../dot-server/ and
 * from the plain `/api/dns-rules` JSON list — see docs/private-dns-fa.md.
 * DoH runs over normal HTTPS (port 443), which Cloudflare Workers *can*
 * host directly (unlike DoT on port 853, which needs the standalone VPS
 * server). So any app or browser that lets you set a *custom DoH URL*
 * (Firefox, most DoH-capable Android apps, `curl`, etc. — NOT Android's
 * system-wide "Private DNS" field, which only speaks DoT) can point
 * straight at `https://<your-worker-domain>/dns-query` with no extra
 * infrastructure at all.
 *
 * Per-query decision logic mirrors dot-server/src/index.ts exactly, just
 * reading the same `dns_rules` D1 table directly instead of polling
 * `/api/dns-rules` over the network:
 *
 *  1. If the queried name matches a 'domain' rule -> answer directly with
 *     the current Cloudflare "clean" IP (no upstream lookup at all).
 *  2. Otherwise, forward the query upstream and get the real answer.
 *  3. If any resolved A/AAAA address in that answer falls inside an 'ip' or
 *     'cidr' rule -> replace the answer with the clean IP instead.
 *  4. Otherwise, return the upstream answer unmodified.
 *
 * Two request styles are supported, auto-detected per request:
 *  - RFC 8484 binary wire format (`application/dns-message`), used by
 *    virtually every real DoH client (browsers, apps, curl --doh-url). This
 *    is the format the original single-file draft of this feature never
 *    actually implemented -- it only recognized JSON bodies, so real DoH
 *    clients silently bypassed the routing rules entirely and every query
 *    just fell through to the "forward upstream, no override" path.
 *  - The Google/Cloudflare-style JSON API (`?name=&type=`), handy for
 *    quick manual testing (e.g. from a browser address bar) and for the
 *    handful of apps that speak JSON DoH instead of wire format.
 */

const DEFAULT_UPSTREAM_DOH_WIRE = 'https://1.1.1.1/dns-query'
const DEFAULT_UPSTREAM_DOH_JSON = 'https://cloudflare-dns.com/dns-query'
const OVERRIDE_TTL = 60
const TYPE_A = 1
const TYPE_AAAA = 28
const CLASS_IN = 1

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
}

// ==================== rule matching (mirrors dot-server/src/rules.ts) ====================

interface IpRange {
  base: bigint
  bits: number
  family: 4 | 6
}

interface CompiledRules {
  domains: string[]
  ranges: IpRange[]
  cleanIp: string | null
}

function ipv4ToInt(ip: string): bigint {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`invalid IPv4 address: ${ip}`)
  }
  return (BigInt(parts[0]!) << 24n) | (BigInt(parts[1]!) << 16n) | (BigInt(parts[2]!) << 8n) | BigInt(parts[3]!)
}

function ipv6ToBigInt(ip: string): bigint {
  const isCompressed = ip.includes('::')
  let groups: string[]
  if (isCompressed) {
    const [head, tail] = ip.split('::')
    const headParts = head ? head.split(':').filter(Boolean) : []
    const tailParts = tail ? tail.split(':').filter(Boolean) : []
    const missing = 8 - headParts.length - tailParts.length
    groups = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts]
  } else {
    groups = ip.split(':')
  }
  if (groups.length !== 8) throw new Error(`invalid IPv6 address: ${ip}`)
  return groups.reduce((acc, part) => (acc << 16n) | BigInt(parseInt(part || '0', 16)), 0n)
}

function parseRange(value: string): IpRange {
  const isV6 = value.includes(':')
  const [addr, prefixStr] = value.split('/')
  const family: 4 | 6 = isV6 ? 6 : 4
  const totalBits = isV6 ? 128 : 32
  const bits = prefixStr !== undefined ? Number(prefixStr) : totalBits
  const base = isV6 ? ipv6ToBigInt(addr!) : ipv4ToInt(addr!)
  return { base, bits, family }
}

/** Reads the shared dns_rules table + best clean IP straight from D1 (no HTTP round-trip needed, unlike dot-server). */
async function compileRules(env: Env): Promise<CompiledRules> {
  if (!env.DB) return { domains: [], ranges: [], cleanIp: null }
  const [rules, cleanIp] = await Promise.all([listDnsRules(env), getBestCleanIp(env)])
  const domains: string[] = []
  const ranges: IpRange[] = []
  for (const r of rules) {
    if (r.kind === 'domain') {
      domains.push(r.value.toLowerCase().replace(/\.$/, ''))
    } else {
      try {
        ranges.push(parseRange(r.value))
      } catch {
        // Skip a malformed stored rule rather than fail every DNS query because of it.
      }
    }
  }
  return { domains, ranges, cleanIp }
}

function domainMatches(rules: CompiledRules, name: string): boolean {
  const host = name.toLowerCase().replace(/\.$/, '')
  for (const d of rules.domains) {
    if (d.startsWith('*.')) {
      const suffix = d.slice(1) // '.example.com'
      if (host === d.slice(2) || host.endsWith(suffix)) return true
    } else if (host === d) {
      return true
    }
  }
  return false
}

function ipMatches(rules: CompiledRules, ip: string): boolean {
  try {
    const isV6 = ip.includes(':')
    const value = isV6 ? ipv6ToBigInt(ip) : ipv4ToInt(ip)
    const family: 4 | 6 = isV6 ? 6 : 4
    const totalBits = isV6 ? 128 : 32
    for (const r of rules.ranges) {
      if (r.family !== family) continue
      const shift = BigInt(totalBits - r.bits)
      if ((value >> shift) === (r.base >> shift)) return true
    }
  } catch {
    // Not a parseable literal IP — treat as no match rather than failing the query.
  }
  return false
}

// ==================== minimal DNS wire-format (RFC 1035) codec ====================
// Just enough to read a query's question, read an upstream response's
// answers (following compression pointers), and build/rebuild simple
// responses. Not a general-purpose DNS library — CNAME chains and other
// non-address records are preserved verbatim (their raw rdata is copied
// through untouched), only A/AAAA rdata is ever rewritten.

interface Question {
  name: string
  type: number
  cls: number
}

interface DecodedAnswer {
  name: string
  type: number
  cls: number
  ttl: number
  data: string | null // parsed IPv4/IPv6 text form, only set for A/AAAA with the expected rdata length
  rawRdata: Uint8Array
}

interface DecodedMessage {
  id: number
  question: Question | null
  answers: DecodedAnswer[]
}

function readName(bytes: Uint8Array, start: number): { name: string; end: number } {
  const labels: string[] = []
  let offset = start
  let sawPointer = false
  let end = -1
  let guard = 0
  while (guard++ < 128) {
    if (offset >= bytes.length) throw new Error('truncated name')
    const len = bytes[offset]!
    if (len === 0) {
      if (!sawPointer) end = offset + 1
      break
    }
    if ((len & 0xc0) === 0xc0) {
      if (offset + 1 >= bytes.length) throw new Error('truncated pointer')
      const pointer = ((len & 0x3f) << 8) | bytes[offset + 1]!
      if (!sawPointer) end = offset + 2
      sawPointer = true
      offset = pointer
      continue
    }
    let label = ''
    for (let i = 0; i < len; i++) label += String.fromCharCode(bytes[offset + 1 + i]!)
    labels.push(label)
    offset += 1 + len
  }
  if (end === -1) throw new Error('unterminated name')
  return { name: labels.join('.'), end }
}

function ipv4ToStr(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`
}

function ipv6ToStr(bytes: Uint8Array, offset: number): string {
  const parts: string[] = []
  for (let i = 0; i < 8; i++) {
    const v = (bytes[offset + i * 2]! << 8) | bytes[offset + i * 2 + 1]!
    parts.push(v.toString(16))
  }
  return parts.join(':')
}

function decodeMessage(buf: ArrayBuffer): DecodedMessage {
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  if (bytes.length < 12) throw new Error('message too short')
  const id = view.getUint16(0)
  const qdcount = view.getUint16(4)
  const ancount = view.getUint16(6)

  let offset = 12
  let question: Question | null = null
  if (qdcount >= 1) {
    const { name, end } = readName(bytes, offset)
    const type = view.getUint16(end)
    const cls = view.getUint16(end + 2)
    question = { name, type, cls }
    offset = end + 4
  }

  const answers: DecodedAnswer[] = []
  for (let i = 0; i < ancount; i++) {
    const { name, end } = readName(bytes, offset)
    const type = view.getUint16(end)
    const cls = view.getUint16(end + 2)
    const ttl = view.getUint32(end + 4)
    const rdlength = view.getUint16(end + 8)
    const rdataStart = end + 10
    const rawRdata = bytes.slice(rdataStart, rdataStart + rdlength)
    let data: string | null = null
    if (type === TYPE_A && rdlength === 4) data = ipv4ToStr(bytes, rdataStart)
    else if (type === TYPE_AAAA && rdlength === 16) data = ipv6ToStr(bytes, rdataStart)
    answers.push({ name, type, cls, ttl, data, rawRdata })
    offset = rdataStart + rdlength
  }

  return { id, question, answers }
}

function encodeName(name: string): Uint8Array {
  if (name === '') return new Uint8Array([0])
  const labels = name.replace(/\.$/, '').split('.')
  const out: number[] = []
  for (const label of labels) {
    out.push(label.length)
    for (let i = 0; i < label.length; i++) out.push(label.charCodeAt(i) & 0xff)
  }
  out.push(0)
  return new Uint8Array(out)
}

function encodeIpv4(ip: string): Uint8Array {
  return new Uint8Array(ip.split('.').map((p) => Number(p) & 0xff))
}

function encodeIpv6(ip: string): Uint8Array {
  const isCompressed = ip.includes('::')
  let groups: string[]
  if (isCompressed) {
    const [head, tail] = ip.split('::')
    const headParts = head ? head.split(':').filter(Boolean) : []
    const tailParts = tail ? tail.split(':').filter(Boolean) : []
    const missing = 8 - headParts.length - tailParts.length
    groups = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts]
  } else {
    groups = ip.split(':')
  }
  const out = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const v = parseInt(groups[i] || '0', 16) & 0xffff
    out[i * 2] = (v >> 8) & 0xff
    out[i * 2 + 1] = v & 0xff
  }
  return out
}

interface EncodableAnswer {
  name: string
  type: number
  cls: number
  ttl: number
  rdata: Uint8Array
}

/** No name compression is used on the way out — larger on the wire but always unambiguous and valid. */
function encodeMessage(id: number, question: Question, answers: EncodableAnswer[]): Uint8Array {
  const qname = encodeName(question.name)
  const parts: Uint8Array[] = []

  const header = new Uint8Array(12)
  const hv = new DataView(header.buffer)
  hv.setUint16(0, id)
  hv.setUint16(2, 0x8180) // QR=1, RD=1, RA=1, RCODE=0 (NOERROR)
  hv.setUint16(4, 1) // QDCOUNT
  hv.setUint16(6, answers.length) // ANCOUNT
  parts.push(header)

  parts.push(qname)
  const qtc = new Uint8Array(4)
  const qv = new DataView(qtc.buffer)
  qv.setUint16(0, question.type)
  qv.setUint16(2, question.cls || CLASS_IN)
  parts.push(qtc)

  for (const a of answers) {
    parts.push(encodeName(a.name))
    const rr = new Uint8Array(10)
    const rv = new DataView(rr.buffer)
    rv.setUint16(0, a.type)
    rv.setUint16(2, a.cls || CLASS_IN)
    rv.setUint32(4, a.ttl)
    rv.setUint16(8, a.rdata.length)
    parts.push(rr)
    parts.push(a.rdata)
  }

  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function base64UrlDecode(input: string): ArrayBuffer {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Applies the "override matched resolved IPs with the clean IP" rule to an
 * already-decoded upstream response. Takes `rules` directly (rather than a
 * shared/cached matcher) because a Worker isolate can interleave multiple
 * concurrent requests — any module-level mutable state would let one
 * request's rule set leak into another's response.
 */
function applyIpOverride(decoded: DecodedMessage, rules: CompiledRules): Uint8Array | null {
  if (!decoded.question || !rules.cleanIp) return null
  const cleanIp = rules.cleanIp
  const hasMatch = decoded.answers.some(
    (a) => (a.type === TYPE_A || a.type === TYPE_AAAA) && a.data !== null && ipMatches(rules, a.data),
  )
  if (!hasMatch) return null

  const isV4 = !cleanIp.includes(':')
  const finalAnswers: EncodableAnswer[] = decoded.answers
    .filter((a) => (isV4 ? a.type !== TYPE_AAAA : a.type !== TYPE_A)) // drop the family we have no clean IP for
    .map((a) => {
      const shouldOverride = (a.type === TYPE_A && isV4) || (a.type === TYPE_AAAA && !isV4)
      return {
        name: a.name,
        type: a.type,
        cls: a.cls,
        ttl: shouldOverride ? OVERRIDE_TTL : a.ttl,
        rdata: shouldOverride ? (isV4 ? encodeIpv4(cleanIp) : encodeIpv6(cleanIp)) : a.rawRdata,
      }
    })
  return encodeMessage(decoded.id, decoded.question, finalAnswers)
}

// ==================== binary (RFC 8484) request handling ====================

async function relayWireToUpstream(
  queryBuf: ArrayBuffer,
  upstreamWire: string,
  rules: CompiledRules | null,
): Promise<Response> {
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamWire, {
      method: 'POST',
      headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' },
      body: queryBuf,
    })
  } catch (err) {
    return new Response('Upstream DoH error: ' + (err instanceof Error ? err.message : String(err)), {
      status: 502,
      headers: CORS_HEADERS,
    })
  }
  if (!upstreamRes.ok) {
    return new Response(await upstreamRes.arrayBuffer(), { status: upstreamRes.status, headers: CORS_HEADERS })
  }

  const upstreamBuf = await upstreamRes.arrayBuffer()
  if (!rules || !rules.cleanIp) {
    return new Response(upstreamBuf, { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/dns-message' } })
  }

  try {
    const decoded = decodeMessage(upstreamBuf)
    const overridden = applyIpOverride(decoded, rules)
    if (overridden) {
      return new Response(overridden, { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/dns-message' } })
    }
  } catch {
    // Malformed/unparseable upstream response — pass it through untouched rather than risk breaking it further.
  }
  return new Response(upstreamBuf, { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/dns-message' } })
}

async function handleWireQuery(request: Request, env: Env, url: URL, upstreamWire: string): Promise<Response> {
  let queryBuf: ArrayBuffer

  if (request.method === 'GET') {
    const dnsParam = url.searchParams.get('dns')
    if (!dnsParam) return new Response('Missing dns parameter', { status: 400, headers: CORS_HEADERS })
    try {
      queryBuf = base64UrlDecode(dnsParam)
    } catch {
      return new Response('Invalid dns parameter', { status: 400, headers: CORS_HEADERS })
    }
  } else if (request.method === 'POST') {
    queryBuf = await request.arrayBuffer()
  } else {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  if (queryBuf.byteLength < 12) {
    return new Response('Malformed DNS query', { status: 400, headers: CORS_HEADERS })
  }

  const rules = await compileRules(env)

  let decoded: DecodedMessage
  try {
    decoded = decodeMessage(queryBuf)
  } catch {
    // Can't safely parse the question -> just relay untouched rather than fail the client.
    return relayWireToUpstream(queryBuf, upstreamWire, rules)
  }

  if (
    decoded.question &&
    (decoded.question.type === TYPE_A || decoded.question.type === TYPE_AAAA) &&
    domainMatches(rules, decoded.question.name) &&
    rules.cleanIp
  ) {
    const isV4 = !rules.cleanIp.includes(':')
    // If the query is AAAA but our only clean IP is IPv4 (the common case), answer
    // NOERROR/NODATA rather than lying with an A-typed record — most clients then
    // fall back to the A query, which we do answer.
    const shouldAnswer = (decoded.question.type === TYPE_A && isV4) || (decoded.question.type === TYPE_AAAA && !isV4)
    const answers: EncodableAnswer[] = shouldAnswer
      ? [
          {
            name: decoded.question.name,
            type: decoded.question.type,
            cls: CLASS_IN,
            ttl: OVERRIDE_TTL,
            rdata: isV4 ? encodeIpv4(rules.cleanIp) : encodeIpv6(rules.cleanIp),
          },
        ]
      : []
    const body = encodeMessage(decoded.id, decoded.question, answers)
    return new Response(body, { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/dns-message' } })
  }

  return relayWireToUpstream(queryBuf, upstreamWire, rules)
}

// ==================== JSON (Google/Cloudflare-style) DoH API ====================

interface JsonAnswer {
  name: string
  type: number
  TTL: number
  data: string
}

async function handleJsonQuery(request: Request, env: Env, url: URL, upstreamJson: string): Promise<Response> {
  let name = url.searchParams.get('name') || ''
  let type = url.searchParams.get('type') || 'A'

  if (!name && request.method === 'POST') {
    try {
      const body = (await request.json()) as { name?: string; type?: string }
      name = body.name || ''
      type = body.type || 'A'
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }
  }

  if (!name) return jsonResponse({ error: 'Missing domain' }, 400)

  const typeNum = type === 'AAAA' || type === String(TYPE_AAAA) ? TYPE_AAAA : TYPE_A
  const rules = await compileRules(env)

  if (domainMatches(rules, name) && rules.cleanIp) {
    const isV4 = !rules.cleanIp.includes(':')
    const shouldAnswer = (typeNum === TYPE_A && isV4) || (typeNum === TYPE_AAAA && !isV4)
    const answer: JsonAnswer[] = shouldAnswer ? [{ name, type: typeNum, TTL: OVERRIDE_TTL, data: rules.cleanIp }] : []
    return jsonResponse({
      Status: 0,
      TC: false,
      RD: true,
      RA: true,
      AD: false,
      CD: false,
      Question: [{ name, type: typeNum }],
      Answer: answer,
    })
  }

  const forwardUrl = new URL(upstreamJson)
  forwardUrl.searchParams.set('name', name)
  forwardUrl.searchParams.set('type', type)

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(forwardUrl.toString(), { headers: { accept: 'application/dns-json' } })
  } catch {
    return jsonResponse({ error: 'Upstream DoH error' }, 502)
  }
  if (!upstreamRes.ok) {
    return jsonResponse({ error: `Upstream DoH returned ${upstreamRes.status}` }, 502)
  }

  let data: { Answer?: JsonAnswer[]; [key: string]: unknown }
  try {
    data = await upstreamRes.json()
  } catch {
    return jsonResponse({ error: 'Invalid upstream response' }, 502)
  }

  const answers = Array.isArray(data.Answer) ? data.Answer : []
  if (rules.cleanIp) {
    const hasMatch = answers.some((a) => (a.type === TYPE_A || a.type === TYPE_AAAA) && typeof a.data === 'string' && ipMatches(rules, a.data))
    if (hasMatch) {
      const isV4 = !rules.cleanIp.includes(':')
      const cleanIp = rules.cleanIp
      data.Answer = answers
        .filter((a) => (isV4 ? a.type !== TYPE_AAAA : a.type !== TYPE_A))
        .map((a) => ((a.type === TYPE_A && isV4) || (a.type === TYPE_AAAA && !isV4) ? { ...a, data: cleanIp, TTL: OVERRIDE_TTL } : a))
    }
  }

  return jsonResponse(data)
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/dns-json' },
  })
}

// ==================== entry point ====================

export async function handleDohRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const url = new URL(request.url)
  const upstreamWire = env.UPSTREAM_DOH || DEFAULT_UPSTREAM_DOH_WIRE
  const upstreamJson = env.UPSTREAM_DOH_JSON || DEFAULT_UPSTREAM_DOH_JSON

  const accept = request.headers.get('accept') || ''
  const contentType = request.headers.get('content-type') || ''
  const wantsJson = url.searchParams.has('name') || accept.includes('application/dns-json') || contentType.includes('application/json')

  if (wantsJson) return handleJsonQuery(request, env, url, upstreamJson)
  return handleWireQuery(request, env, url, upstreamWire)
}
