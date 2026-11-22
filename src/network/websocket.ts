import { parseVlessHeader } from '../protocols/index'
import { processTCP, type ClientReader, type UsageCounter } from './tcp'
import { safeCloseWebSocket } from '../utils/helpers'
import { processDNS } from './dns'
import { authorizeConnection, recordUsageBytes, isOverQuota } from '../services/access'
import { splitAndFilter } from '../utils/array'

import type { Env } from '../core/types'

const HEADER_TIMEOUT_MS = 10_000

/** Decodes base64url early data sent in the Sec-WebSocket-Protocol header. */
function decodeEarlyData(value: string): Uint8Array | null {
  try {
    const b64 = value.split(',')[0]!.trim().replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    // A real VLESS header is at least 24 bytes and starts with version 0/1.
    // Anything else is an ordinary subprotocol name, not early data.
    if (out.length < 24 || (out[0] !== 0 && out[0] !== 1)) return null
    return out
  } catch {
    return null
  }
}

/**
 * Turns WebSocket messages into a byte stream. Listeners are attached
 * synchronously, so nothing the client sends while we are still doing async
 * work (database auth, connecting upstream) can be lost.
 */
function createClientReader(ws: WebSocket, early: Uint8Array | null): ClientReader {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (early) controller.enqueue(early)
      ws.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as unknown
        if (typeof data === 'string') return
        try {
          if (data instanceof ArrayBuffer) controller.enqueue(new Uint8Array(data))
          else if (ArrayBuffer.isView(data)) {
            controller.enqueue(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
          }
        } catch {
          /* stream already closed */
        }
      })
      ws.addEventListener('close', () => {
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      })
      ws.addEventListener('error', () => {
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      })
    },
    cancel() {
      safeCloseWebSocket(ws)
    },
  })
  return stream.getReader()
}

async function readFirstChunk(reader: ClientReader): Promise<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('timeout waiting for protocol header')), HEADER_TIMEOUT_MS)
  })
  try {
    const { done, value } = await Promise.race([reader.read(), timeout])
    if (done || !value) throw Error('connection closed before protocol header')
    return value
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Processes incoming WebSocket connections (the VLESS tunnel itself)
 * @param request - Incoming request
 * @param env - Environment variables
 * @param ctx - Execution context, used to persist usage accounting after the response is sent
 */
export function processWebSocket(request: Request, env: Env, ctx?: ExecutionContext): Response {
  const proxyIPs = splitAndFilter(env.PROXY_IP || '', ',')
    .map((v) => v.trim())
    .filter(Boolean)

  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()

  const protocolHeader = request.headers.get('Sec-WebSocket-Protocol')
  const early = protocolHeader ? decodeEarlyData(protocolHeader) : null
  const reader = createClientReader(server, early)

  const counter: UsageCounter = { bytes: 0, flushedBytes: 0 }

  void (async () => {
    const first = await readFirstChunk(reader)
    const header = parseVlessHeader(
      first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) as ArrayBuffer,
    )

    const auth = await authorizeConnection(env, header.uuid)
    if (!auth.ok) {
      throw Error(`unauthorized: ${auth.reason}`)
    }

    counter.onFlush = (deltaBytes) => {
      const task = (async () => {
        await recordUsageBytes(env, auth, deltaBytes)
        // Cut the tunnel as soon as a mid-stream flush pushes the user over quota.
        if (await isOverQuota(env, auth)) safeCloseWebSocket(server)
      })().catch((err) => console.error('usage flush failed:', err))
      if (ctx) ctx.waitUntil(task)
    }

    try {
      if (header.isUDP) {
        if (header.port === 53) {
          await processDNS(server, header, counter, reader)
        } else {
          throw Error('UDP transport is unsupported')
        }
      } else {
        await processTCP(server, header, proxyIPs, counter, reader)
      }
    } finally {
      // Only the remainder not already covered by a mid-stream onFlush.
      const remaining = counter.bytes - counter.flushedBytes
      if (remaining > 0) {
        const persist = recordUsageBytes(env, auth, remaining)
        if (ctx) ctx.waitUntil(persist)
        else await persist
      }
    }
  })().catch((err) => {
    console.error(err)
    safeCloseWebSocket(server)
  })

  const headers = new Headers()
  // If the client offered a subprotocol (early data travels in it), the
  // handshake is only valid when the server echoes one back.
  if (protocolHeader) headers.set('Sec-WebSocket-Protocol', protocolHeader.split(',')[0]!.trim())

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers,
  })
}
