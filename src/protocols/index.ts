import { Protocol } from '../constants/protocol'
import { contains } from '../utils/array'

/**
 * Custom error classes for protocol handling
 */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

export class InvalidHeaderError extends ProtocolError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidHeaderError'
  }
}

export class AuthenticationError extends ProtocolError {
  constructor(message: string) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

/**
 * Parses UUID from ArrayBuffer
 * @param buf - ArrayBuffer containing UUID data
 * @returns Formatted UUID string
 */
function parseUUID(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

export interface Header {
  version: number
  uuid: string
  isUDP: boolean
  address: string
  port: number
  rawData: ArrayBuffer
}

/**
 * Parses the structural fields of a VLESS protocol header, WITHOUT checking
 * whether the embedded UUID is authorized. Authorization is performed
 * separately (and may be async, e.g. a database lookup) via the caller.
 * @param value - ArrayBuffer containing header data
 * @returns Parsed header information, including the raw uuid string
 */
export function parseVlessHeader(value: ArrayBuffer): Header {
  if (value.byteLength < 24) {
    throw Error('invalid protocol header')
  }

  const dataView = new DataView(value)
  const version = dataView.getUint8(0)
  if (
    version !== Protocol.RELEASE_VERSION &&
    version !== Protocol.TESTING_VERSION
  ) {
    throw Error(`invalid protocol version ${version}`)
  }

  const uuidString = parseUUID(value.slice(1, 17))

  const optionLength = dataView.getUint8(17)
  const command = dataView.getUint8(18 + optionLength)
  if (command !== Protocol.COMMAND_TCP && command !== Protocol.COMMAND_UDP) {
    throw Error(`unsupported command ${command}`)
  }

  const portIndex = 18 + optionLength + 1
  const remotePort = dataView.getUint16(portIndex)
  const addressType = dataView.getUint8(portIndex + 2)

  let remoteAddress = ''
  let addressLength: number, addressValueIndex: number
  switch (addressType) {
    case Protocol.ADDRESS_TYPE_IPV4:
      addressLength = 4
      addressValueIndex = portIndex + 3
      remoteAddress = new Uint8Array(
        value.slice(addressValueIndex, addressValueIndex + addressLength),
      ).join('.')
      break
    case Protocol.ADDRESS_TYPE_DOMAIN:
      addressLength = dataView.getUint8(portIndex + 3)
      addressValueIndex = portIndex + 4
      remoteAddress = new TextDecoder().decode(
        value.slice(addressValueIndex, addressValueIndex + addressLength),
      )
      break
    case Protocol.ADDRESS_TYPE_IPV6:
      addressLength = 16
      addressValueIndex = portIndex + 3
      remoteAddress = Array.from({ length: 8 }, (_, i) =>
        dataView.getUint16(addressValueIndex + i * 2).toString(16),
      ).join(':')
      break
    default:
      throw Error(`invalid address type ${addressType}`)
  }
  
  return {
    version,
    uuid: uuidString,
    isUDP: command === Protocol.COMMAND_UDP,
    address: remoteAddress,
    port: remotePort,
    rawData: value.slice(addressValueIndex + addressLength),
  }
}

/**
 * Backwards-compatible synchronous variant: parses the header and checks the
 * UUID against a static allow-list. Kept for callers that don't need dynamic
 * (database-backed) authorization.
 * @param value - ArrayBuffer containing header data
 * @param uuids - Array of valid UUIDs
 * @returns Parsed header information
 */
export function processHeader(value: ArrayBuffer, uuids: string[]): Header {
  const header = parseVlessHeader(value)
  if (!contains(uuids, header.uuid)) {
    throw Error(`invalid user ${header.uuid}`)
  }
  return header
}