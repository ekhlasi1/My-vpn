/**
 * Protocol constants for VLESS proxy
 */
export const Protocol = {
  TESTING_VERSION: 0,
  RELEASE_VERSION: 1,
  // Command types
  COMMAND_TCP: 1,
  COMMAND_UDP: 2,
  COMMAND_MUX: 3,
  // Address types
  ADDRESS_TYPE_IPV4: 1,
  ADDRESS_TYPE_DOMAIN: 2,
  ADDRESS_TYPE_IPV6: 3,
  // Response helpers
  RESPONSE_DATA: (v: number): ArrayBuffer => {
    return new Uint8Array([v, 0]).buffer
  },
}