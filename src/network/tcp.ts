import { connect } from 'cloudflare:sockets'
import { Protocol } from '../constants/protocol'
import { safeCloseWebSocket } from '../utils/helpers'
import type { Header } from '../protocols/index'

/**
 * Mutable byte counter shared across a proxied connection's lifetime.
 *
 * IMPORTANT: `onFlush` exists to fix a real accuracy bug — usage used to only
 * get persisted to D1 once the whole TCP stream finished (see the old
 * `finally` block in websocket.ts). VLESS/VPN tunnels are often long-lived
 * (a single stream can stay open for the duration of a video call, a
 * download, etc.), so "record usage at the end" meant the dashboard's
 * volume_used_mb was stale for as long as the connection stayed open, and
 * the "you've used another N MB" Telegram notice (which is driven off that
 * same number) effectively never fired during active use. `countBytes` now
 * calls `onFlush` every ~1MB so usage — and the notification threshold — are
 * checked continuously while the connection is still open, not just at the end.
 */
export interface UsageCounter {
  bytes: number
  flushedBytes: number
  onFlush?: (deltaBytes: number) => void
}

/** Flush accumulated usage to D1 (and re-check the notification threshold) every ~1MB. */
const FLUSH_THRESHOLD_BYTES = 1 * 1024 * 1024

function countBytes(counter: UsageCounter | undefined, data: ArrayBuffer | ArrayBufferView | unknown): void {
  if (!counter) return
  if (data instanceof ArrayBuffer) counter.bytes += data.byteLength
  else if (ArrayBuffer.isView(data as ArrayBufferView)) counter.bytes += (data as ArrayBufferView).byteLength
  else return

  if (counter.onFlush) {
    const delta = counter.bytes - counter.flushedBytes
    if (delta >= FLUSH_THRESHOLD_BYTES) {
      counter.flushedBytes = counter.bytes
      counter.onFlush(delta)
    }
  }
}

async function retry(
  version: number,
  rawData: ArrayBuffer,
  ws: WebSocket,
  proxyIPs: string[],
  counter?: UsageCounter,
): Promise<Socket | undefined> {
  for (const proxyIP of proxyIPs) {
    try {
      const socket = await dial(proxyIP, version, rawData, ws, counter)
      return socket
    } catch (err) {
      console.error(err)
      continue
    }
  }
}

async function dial(
  remote: SocketAddress | string,
  version: number,
  rawData: ArrayBuffer,
  ws: WebSocket,
  counter?: UsageCounter,
): Promise<Socket> {
  let messageFn = null
  let closeFn = null
  let errorFn = null
  try {
    const socket = connect(remote)
    const writer = socket.writable.getWriter()
    await writer.write(rawData)
    countBytes(counter, rawData)
    messageFn = async (event: MessageEvent) => {
      await writer.write(event.data)
      countBytes(counter, event.data)
    }
    closeFn = async () => {
      await socket.close()
    }
    errorFn = async () => {
      await socket.close()
    }
    ws.addEventListener('message', messageFn)
    ws.addEventListener('close', closeFn)
    ws.addEventListener('error', errorFn)

    const reader = socket.readable.getReader()
    const { done, value } = await reader.read()
    if (done) {
      throw Error('connection was done')
    }
    reader.releaseLock()
    ws.send(
      await new Blob([Protocol.RESPONSE_DATA(version), value]).arrayBuffer(),
    )
    return socket
  } catch (err) {
    if (messageFn) {
      ws.removeEventListener('message', messageFn)
    }
    if (closeFn) {
      ws.removeEventListener('close', closeFn)
    }
    if (errorFn) {
      ws.removeEventListener('error', errorFn)
    }
    throw err
  }
}

export async function processTCP(
  ws: WebSocket,
  header: Header,
  proxyIPs: string[],
  counter?: UsageCounter,
) {
  let socket: Socket | undefined
  try {
    // `connect()` (cloudflare:sockets) already resolves hostnames at the edge
    // on its own — a prior version of this function pre-resolved domain
    // addresses via a DNS-over-HTTPS `fetch()` before dialing. That added a
    // full extra network round trip (and a new failure/timeout point) to
    // *every single* new stream for a domain-based destination, on top of
    // the TCP dial itself, without changing what address was actually
    // connected to. Removed — pass the hostname straight to `connect()`.
    socket = await dial(
      { hostname: header.address, port: header.port },
      header.version,
      header.rawData,
      ws,
      counter,
    )
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_) {
    socket = await retry(header.version, header.rawData, ws, proxyIPs, counter)
  }
  if (socket === undefined) {
    throw Error(
      `cannot connect to hostname: ${header.address}, port: ${header.port}`,
    )
  }
  await socket.readable.pipeTo(
    new WritableStream({
      write(chunk) {
        countBytes(counter, chunk)
        ws.send(chunk)
      },
      abort() {
        safeCloseWebSocket(ws)
      },
      close() {
        safeCloseWebSocket(ws)
      },
    }),
  )
}
