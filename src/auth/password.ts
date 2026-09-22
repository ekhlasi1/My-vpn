// Password hashing (PBKDF2-SHA256) and token generation using Web Crypto,
// which is natively available in the Cloudflare Workers runtime.

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return out
}

/**
 * Constant-time string comparison (same length-then-XOR pattern already used
 * inside verifyPassword below). Use this for any secret-token comparison
 * (session tokens, the worker-sync shared secret, etc.) instead of `===`,
 * which short-circuits on the first differing character and can leak how
 * many leading characters an attacker guessed correctly via timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export function generateRandomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return toHex(arr.buffer)
}

async function pbkdf2(password: string, salt: Uint8Array, iterations = 100_000): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
}

/** Returns "salt:hash" (both hex) suitable for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const derived = await pbkdf2(password, salt)
  return `${toHex(salt.buffer)}:${toHex(derived)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.includes(':')) return false
  const [saltHex, hashHex] = stored.split(':')
  const salt = fromHex(saltHex)
  const derived = await pbkdf2(password, salt)
  const derivedHex = toHex(derived)
  // constant-time-ish compare
  if (derivedHex.length !== hashHex.length) return false
  let diff = 0
  for (let i = 0; i < derivedHex.length; i++) {
    diff |= derivedHex.charCodeAt(i) ^ hashHex.charCodeAt(i)
  }
  return diff === 0
}
