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