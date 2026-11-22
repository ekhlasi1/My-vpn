/**
 * Safely closes a WebSocket connection
 * @param ws - WebSocket to close
 */
export function safeCloseWebSocket(ws: WebSocket): void {
  try {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CLOSING
    ) {
      ws.close()
    }
  } catch (err) {
    console.error(`Error closing WebSocket: ${err}`)
  }
}

/**
 * Delays execution for specified milliseconds
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generates a random number between min and max (inclusive)
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Random number
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Concatenates byte arrays into a single Uint8Array
 */
export function concatBytes(...parts: Uint8Array[]) {
  let total = 0
  for (const p of parts) total += p.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}

/** UTF-8 safe base64 encoder (btoa alone breaks on non-Latin1 characters). */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
