import { connect } from 'cloudflare:sockets'
import { safeCloseWebSocket } from '../utils/helpers'
import { Protocol } from '../constants/protocol'
import type { Header } from '../protocols/index'

export async function processDNS(ws: WebSocket, header: Header) {
  const socket = connect({
    hostname: '8.8.8.8',
    port: 53,
  })
  const writer = socket.writable.getWriter()
  await writer.write(header.rawData)
  ws.addEventListener('message', async (event) => {
    await writer.write(event.data)
  })
  ws.addEventListener('close', async () => {
    await socket.close()
  })
  ws.addEventListener('error', async () => {
    await socket.close()
  })
  const reader = socket.readable.getReader()
  const { done, value } = await reader.read()
  if (done) {
    throw Error('connection was done')
  }
  reader.releaseLock()
  ws.send(
    await new Blob([
      Protocol.RESPONSE_DATA(header.version),
      value,
    ]).arrayBuffer(),
  )

  await socket.readable.pipeTo(
    new WritableStream({
      write(chunk) {
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
