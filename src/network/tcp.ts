import { connect } from 'cloudflare:sockets'
import { safeCloseWebSocket, concatBytes } from '../utils/helpers'
import type { Header } from '../protocols/index'

/**
 * Mutable byte counter shared across a proxied connection's lifetime.
 *
 * `onFlush` persists usage to D1 every ~1MB while the tunnel is still open
 * (long-lived tunnels would otherwise only be accounted for when they close).
 */
export interface UsageCounter {
  bytes: number
  flushedBytes: number
  onFlush?: (deltaBytes: number) => void
}

/** Flush accumulated usage (and re-check quota / notification threshold) every ~1MB. */
const FLUSH_THRESHOLD_BYTES = 1 * 1024 * 1024
const WS_OPEN = 1

export type ClientReader = ReadableStreamDefaultReader<Uint8Array>

export function countBytes(counter: UsageCounter | undefined, byteLength: number): void {
  if (!counter || byteLength <= 0) return
  counter.bytes += byteLength
  if (counter.onFlush) {
    const delta = counter.bytes - counter.flushedBytes
    if (delta >= FLUSH_THRESHOLD_BYTES) {
      counter.flushedBytes = counter.bytes
      counter.onFlush(delta)
    }
  }
}

interface Upstream {
  socket: Socket
  writer: WritableStreamDefaultWriter<Uint8Array>
}

function openUpstream(target: SocketAddress | string, initial: Uint8Array): Upstream {
  const socket = connect(target)
  const writer = socket.writable.getWriter()
  if (initial.byteLength > 0) {
    // A failed write surfaces through socket.readable erroring/closing,
    // which is what triggers the fallback to the next target.
    writer.write(initial).catch(() => {})
  }
  return { socket, writer }
}

function closeUpstream(up: Upstream | null): void {
  if (!up) return
  try {
    up.writer.releaseLock()
  } catch {
    /* ignore */
  }
  try {
    void up.socket.close().catch(() => {})
  } catch {
    /* ignore */
  }
}

/**
 * Copies everything the remote sends to the WebSocket. The VLESS response
 * header ([version, 0]) is prepended to the very first chunk only.
 * Resolves to true if at least one chunk was delivered to the client.
 */
async function pipeRemoteToWs(
  socket: Socket,
  ws: WebSocket,
  responseHeader: Uint8Array,
  counter?: UsageCounter,
): Promise<boolean> {
  let delivered = false
  try {
    await socket.readable.pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          if (ws.readyState !== WS_OPEN) throw new Error('websocket closed')
          if (!delivered) {
            ws.send(concatBytes(responseHeader, chunk))
            delivered = true
          } else {
            ws.send(chunk as Uint8Array<ArrayBuffer>)
          }
          countBytes(counter, chunk.byteLength)
        },
      }),
    )
  } catch {
    // remote reset / websocket closed: fall through with what we have
  }
  return delivered
}

function normalizeProxyTarget(entry: string): string {
  const e = entry.trim()
  // "host:port", "[ipv6]:port" or bare host (default to 443)
  if (/^\[.*\]:\d+$/.test(e) || /^[^:]+:\d+$/.test(e)) return e
  return `${e}:443`
}

/**
 * Relays one proxied stream: client (WebSocket) <-> first target that works.
 *
 * Targets are tried in order. A target counts as failed when it threw while
 * connecting or closed without sending a single byte back — the typical
 * symptom of a Worker trying to reach a Cloudflare-hosted destination
 * directly, which is exactly what the PROXY_IP fallbacks exist for.
 */
export async function relay(
  ws: WebSocket,
  header: Header,
  targets: (SocketAddress | string)[],
  counter: UsageCounter | undefined,
  clientReader: ClientReader,
): Promise<void> {
  const responseHeader = new Uint8Array([header.version, 0])
  const initial = new Uint8Array(header.rawData)
  let current: Upstream | null = null
  let pumpStarted = false
  let finished = false

  // Client -> remote. Always writes to whichever upstream is current, so a
  // fallback switch is transparent to the pump.
  const startPump = () => {
    if (pumpStarted) return
    pumpStarted = true
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await clientReader.read()
          if (done) break
          if (!value || value.byteLength === 0) continue
          countBytes(counter, value.byteLength)
          const up = current
          if (!up) continue
          try {
            await up.writer.write(value)
          } catch {
            // upstream died; the read side will notice and move on / close
          }
        }
      } catch {
        /* client stream errored */
      } finally {
        if (finished || ws.readyState !== WS_OPEN) closeUpstream(current)
      }
    })()
  }

  let delivered = false
  for (const target of targets) {
    if (ws.readyState !== WS_OPEN) break
    let up: Upstream
    try {
      up = openUpstream(target, initial)
    } catch (err) {
      console.error('connect failed:', err)
      continue
    }
    current = up
    startPump()
    delivered = await pipeRemoteToWs(up.socket, ws, responseHeader, counter)
    if (delivered) break
    closeUpstream(up)
    current = null
  }

  finished = true
  closeUpstream(current)
  try {
    await clientReader.cancel()
  } catch {
    /* ignore */
  }
  safeCloseWebSocket(ws)

  if (!delivered) {
    throw Error(`cannot connect to ${header.address}:${header.port}`)
  }
}

export async function processTCP(
  ws: WebSocket,
  header: Header,
  proxyIPs: string[],
  counter: UsageCounter | undefined,
  clientReader: ClientReader,
): Promise<void> {
  // Connect by hostname directly. Resolving the name ourselves first (as an
  // earlier version did) only added a round trip and broke IPv6-only hosts;
  // the runtime resolves the name itself.
  const targets: (SocketAddress | string)[] = [
    { hostname: header.address, port: header.port },
    ...proxyIPs.map(normalizeProxyTarget),
  ]
  await relay(ws, header, targets, counter, clientReader)
}
