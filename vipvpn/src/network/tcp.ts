import { connect } from 'cloudflare:sockets'
import { Protocol } from '../constants/protocol'
import { safeCloseWebSocket } from '../utils/helpers'
import type { Header } from '../protocols/index'

/** Simple mutable byte counter shared across a proxied connection's lifetime. */
export interface UsageCounter {
  bytes: number
}

function countBytes(counter: UsageCounter | undefined, data: ArrayBuffer | ArrayBufferView | unknown): void {
  if (!counter) return
  if (data instanceof ArrayBuffer) counter.bytes += data.byteLength
  else if (ArrayBuffer.isView(data as ArrayBufferView)) counter.bytes += (data as ArrayBufferView).byteLength
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
    // For domain addresses, we need to resolve them first
    let address = header.address
    if (isNaN(Number(address.split('.')[0]))) {
      // This looks like a domain name, try to resolve it
      try {
        const resolved = await resolveDomain(address)
        address = resolved
      } catch (resolveErr) {
        console.error(`Failed to resolve domain ${address}:`, resolveErr)
        // Fall back to original address
      }
    }
    
    socket = await dial(
      { hostname: address, port: header.port },
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

// Add domain resolution function
async function resolveDomain(domain: string): Promise<string> {
  // Try to resolve the domain using DNS over HTTPS
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, {
      headers: {
        'Accept': 'application/dns-json'
      }
    })
    
    if (response.ok) {
      const data: any = await response.json()
      if (data.Answer && data.Answer.length > 0) {
        // Return the first A record
        const aRecord = data.Answer.find((record: any) => record.type === 1)
        if (aRecord) {
          return aRecord.data
        }
      }
    }
  } catch (err) {
    console.error('DNS resolution error:', err)
  }
  
  // Fallback to the original domain if resolution fails
  return domain
}
