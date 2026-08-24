import { parseVlessHeader } from '../protocols/index'
import { processTCP, type UsageCounter } from './tcp'
import { safeCloseWebSocket } from '../utils/helpers'
import { processDNS } from './dns'
import { authorizeConnection, recordUsageBytes, isOverQuota } from '../services/access'

import type { Env } from '../core/types'

/**
 * Decodes early data from base64url encoding
 * @param earlyData - Base64url encoded string
 * @returns Decoded ArrayBuffer
 */
function decodeEarlyData(earlyData: string): ArrayBuffer {
  earlyData = earlyData.replace(/-/g, '+').replace(/_/g, '/')
  const binaryStr = atob(earlyData)
  const buffer = new ArrayBuffer(binaryStr.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < binaryStr.length; i++) {
    view[i] = binaryStr.charCodeAt(i)
  }
  return buffer
}

/**
 * Gets the initial header from WebSocket connection
 * @param ws - WebSocket connection
 * @param earlyData - Early data from Sec-WebSocket-Protocol header
 * @returns Promise resolving to ArrayBuffer of header data
 */
function getHeader(
  ws: WebSocket,
  earlyData: string | null,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (earlyData) {
      try {
        const data = decodeEarlyData(earlyData)
        resolve(data)
      } catch (err) {
        reject(err)
      }
    }

    const handleMsg = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        reject('invalid data')
      } else {
        resolve(event.data)
      }
      ws.removeEventListener('message', handleMsg)
      ws.removeEventListener('error', handleErr)
    }

    const handleErr = (event: Event) => {
      // @ts-ignore
      reject(event.error || 'WebSocket error')
      ws.removeEventListener('message', handleMsg)
      ws.removeEventListener('error', handleErr)
    }

    ws.addEventListener('message', handleMsg)
    ws.addEventListener('error', handleErr)

    setTimeout(() => {
      reject('timeout')
      ws.removeEventListener('message', handleMsg)
      ws.removeEventListener('error', handleErr)
    }, 10000)
  })
}

/**
 * Processes incoming WebSocket connections
 * @param request - Incoming request
 * @param env - Environment variables
 * @param ctx - Execution context, used to persist usage accounting after response is sent
 * @returns Response with WebSocket upgrade
 */
export function processWebSocket(request: Request, env: Env, ctx?: ExecutionContext): Response {
  const proxyIPs = env.PROXY_IP.split(',').filter((v) => v !== '')

  const [client, server] = Object.values(new WebSocketPair())
  if (server === undefined) {
    throw 'WebSocket server not defined'
  }
  if (client === undefined) {
    throw 'WebSocket client not defined'
  }

  server.accept()

  const counter: UsageCounter = { bytes: 0, flushedBytes: 0 }

  getHeader(server, request.headers.get('Sec-WebSocket-Protocol'))
    .then((v) => parseVlessHeader(v))
    .then(async (header) => {
      const auth = await authorizeConnection(env, header.uuid)
      if (!auth.ok) {
        throw Error(`unauthorized: ${auth.reason}`)
      }

      // Persist usage (and re-check the notification threshold / live quota)
      // every ~1MB instead of only once the whole stream finishes — see the
      // UsageCounter doc comment in tcp.ts for why this matters.
      counter.onFlush = (deltaBytes) => {
        const task = (async () => {
          await recordUsageBytes(env, auth, deltaBytes)
          // If this flush just pushed the user over their quota, cut the
          // tunnel immediately instead of waiting for it to close naturally.
          if (await isOverQuota(env, auth)) safeCloseWebSocket(server)
        })().catch((err) => console.error('usage flush failed:', err))
        if (ctx) ctx.waitUntil(task)
      }

      try {
        if (header.isUDP) {
          if (header.port === 53) {
            await processDNS(server, header)
          } else {
            throw Error('UDP transport is unsupported')
          }
        } else {
          await processTCP(server, header, proxyIPs, counter)
        }
      } finally {
        // Only the remainder not already covered by a mid-stream onFlush.
        const remaining = counter.bytes - counter.flushedBytes
        const persist = remaining > 0 ? recordUsageBytes(env, auth, remaining) : Promise.resolve()
        if (ctx) ctx.waitUntil(persist)
        else await persist
      }
    })
    .catch((err) => {
      console.error(err)
      safeCloseWebSocket(server)
    })

  return new Response(null, {
    status: 101,
    webSocket: client,
  })
}