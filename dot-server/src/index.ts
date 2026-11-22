/**
 * DNS-over-TLS (RFC 7858) server for Android's "Private DNS" (hostname mode).
 *
 * This is deliberately a SEPARATE, standalone Node process — not part of the
 * Cloudflare Worker in ../src. Workers only ever answer HTTP(S) `fetch`
 * events; they cannot accept an inbound raw TCP/TLS connection on port 853,
 * which is the only thing Android's native Private DNS field actually
 * speaks. So this has to run somewhere with a real, persistent listening
 * socket — a small VPS is the usual choice. See ../docs/private-dns-fa.md
 * for the full setup walkthrough (TLS cert, systemd unit, Android steps).
 *
 * Per-query logic:
 *  1. If the queried name matches a 'domain' rule from the worker's public
 *     /api/dns-rules list -> answer directly with the current Cloudflare
 *     "clean" IP (no upstream lookup at all).
 *  2. Otherwise, forward the query upstream via DoH and get the real answer.
 *  3. If any resolved A/AAAA address in that answer falls inside an 'ip' or
 *     'cidr' rule -> replace the answer with the clean IP instead.
 *  4. Otherwise, return the upstream answer completely unmodified (direct).
 */
import * as tls from 'node:tls'
import * as fs from 'node:fs'
// @ts-expect-error - dns-packet has no bundled types beyond @types/dns-packet
import * as dnsPacket from 'dns-packet'
import { config } from './config.js'
import { startRulesRefreshLoop, domainMatches, ipMatches, getCleanIp } from './rules.js'

const TYPE_A = 'A'
const TYPE_AAAA = 'AAAA'

/** One synthetic answer pointing at the Cloudflare clean IP, for a single question. */
function cleanIpAnswerPacket(id: number, name: string, type: string, cleanIp: string): Buffer {
  const isV4 = !cleanIp.includes(':')
  // If the query is AAAA but our clean IP is only IPv4 (the common case),
  // answer NOERROR/NODATA rather than lying with an A-typed record — most
  // clients then just fall back to the A query, which we do answer.
  const answers =
    (type === TYPE_A && isV4) || (type === TYPE_AAAA && !isV4)
      ? [{ type, name, ttl: config.overrideTtl, data: cleanIp }]
      : []
  return dnsPacket.encode({
    type: 'response',
    id,
    flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE,
    questions: [{ type, name }],
    answers,
  })
}

async function forwardUpstream(queryBuf: Buffer): Promise<Buffer> {
  const res = await fetch(config.upstreamDohUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' },
    body: queryBuf,
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`upstream DoH ${config.upstreamDohUrl} -> ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Applies the "override matched resolved IPs with the clean IP" rule (step 3 above) to an upstream response. */
function applyIpOverride(responseBuf: Buffer): Buffer {
  const cleanIp = getCleanIp()
  if (!cleanIp) return responseBuf
  let decoded: any
  try {
    decoded = dnsPacket.decode(responseBuf)
  } catch {
    return responseBuf // malformed/unparseable — pass through untouched rather than risk breaking it further
  }
  const answers: any[] = decoded.answers || []
  const hasMatchedIp = answers.some((a) => (a.type === TYPE_A || a.type === TYPE_AAAA) && typeof a.data === 'string' && ipMatches(a.data))
  if (!hasMatchedIp) return responseBuf

  const isV4 = !cleanIp.includes(':')
  decoded.answers = answers
    .filter((a) => (isV4 ? a.type !== TYPE_AAAA : a.type !== TYPE_A)) // drop the family we can't override
    .map((a) => {
      if ((a.type === TYPE_A && isV4) || (a.type === TYPE_AAAA && !isV4)) {
        return { ...a, data: cleanIp, ttl: config.overrideTtl }
      }
      return a
    })
  return dnsPacket.encode(decoded)
}

async function answerQuery(queryBuf: Buffer): Promise<Buffer> {
  const decoded = dnsPacket.decode(queryBuf) as any
  const question = decoded.questions?.[0]

  if (question && (question.type === TYPE_A || question.type === TYPE_AAAA) && domainMatches(question.name)) {
    const cleanIp = getCleanIp()
    if (cleanIp) {
      return cleanIpAnswerPacket(decoded.id, question.name, question.type, cleanIp)
    }
    // No healthy clean IP discovered yet on the worker side — fall back to a
    // normal upstream answer rather than returning SERVFAIL for every
    // matched domain during that window.
  }

  const upstreamBuf = await forwardUpstream(queryBuf)
  return applyIpOverride(upstreamBuf)
}

// ---------- RFC 7858 framing: each DNS message over TLS/TCP is prefixed with a 2-byte big-endian length ----------

function handleConnection(socket: tls.TLSSocket): void {
  let buf = Buffer.alloc(0)

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 2) {
      const msgLen = buf.readUInt16BE(0)
      if (buf.length < 2 + msgLen) break // wait for the rest of this message
      const msg = buf.subarray(2, 2 + msgLen)
      buf = buf.subarray(2 + msgLen)

      answerQuery(Buffer.from(msg))
        .then((answer) => {
          const framed = Buffer.alloc(2 + answer.length)
          framed.writeUInt16BE(answer.length, 0)
          answer.copy(framed, 2)
          if (!socket.destroyed) socket.write(framed)
        })
        .catch((err) => {
          console.error('[dot] query failed:', err)
          if (!socket.destroyed) socket.destroy()
        })
    }
  })

  socket.on('error', (err) => console.error('[dot] socket error:', err.message))
}

async function main(): Promise<void> {
  await startRulesRefreshLoop()

  const server = tls.createServer(
    {
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath),
      // ALPN isn't strictly required for DoT, but some client stacks probe it.
      ALPNProtocols: ['dot'],
    },
    handleConnection,
  )

  server.listen(config.port, () => {
    console.log(`[dot] listening on :${config.port} as ${config.hostname}`)
    console.log(`[dot] rules source: ${config.workerBaseUrl}/api/dns-rules (refresh every ${config.rulesRefreshSeconds}s)`)
  })
}

main().catch((err) => {
  console.error('[dot] fatal startup error:', err)
  process.exit(1)
})
