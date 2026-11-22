import type { Header } from '../protocols/index'
import { relay, type ClientReader, type UsageCounter } from './tcp'

// Cloudflare Workers cannot dial Cloudflare's own resolvers (1.1.1.1), so the
// DNS-over-TCP upstreams are Google's.
const DNS_UPSTREAMS = [
  { hostname: '8.8.8.8', port: 53 },
  { hostname: '8.8.4.4', port: 53 },
]

/**
 * VLESS "UDP" to port 53: the client sends length-prefixed DNS messages,
 * which is byte-for-byte the DNS-over-TCP framing, so the stream can be
 * relayed to a TCP resolver unchanged.
 */
export async function processDNS(
  ws: WebSocket,
  header: Header,
  counter: UsageCounter | undefined,
  clientReader: ClientReader,
): Promise<void> {
  await relay(ws, header, DNS_UPSTREAMS, counter, clientReader)
}
