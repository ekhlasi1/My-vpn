// Core types and interfaces

export interface Env {
  UUID: string
  PROXY_IP: string
  DB: D1Database
  // Optional overrides for the Worker-native DoH endpoint (src/network/doh.ts).
  // Both have sane defaults (Cloudflare's own resolvers) if left unset.
  UPSTREAM_DOH?: string // upstream for RFC 8484 binary wire-format queries
  UPSTREAM_DOH_JSON?: string // upstream for the JSON (?name=&type=) DoH API
}

export interface Header {
  version: number
  isUDP: boolean
  address: string
  port: number
  rawData: ArrayBuffer
}

export interface ProtocolConfig {
  TESTING_VERSION: number
  RELEASE_VERSION: number
  COMMAND_TCP: number
  COMMAND_UDP: number
  COMMAND_MUX: number
  ADDRESS_TYPE_IPV4: number
  ADDRESS_TYPE_DOMAIN: number
  ADDRESS_TYPE_IPV6: number
  RESPONSE_DATA: (v: number) => ArrayBuffer
}