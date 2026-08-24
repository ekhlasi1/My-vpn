import type { Env } from '../core/types'
import { createSession, deleteSession, isSessionValid } from '../db/queries'
import { generateRandomToken } from './password'

const COOKIE_NAME = 'fc_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  const parts = header.split(';').map((p) => p.trim())
  for (const part of parts) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx)
    if (key === name) return decodeURIComponent(part.slice(idx + 1))
  }
  return null
}

export async function createAdminSession(env: Env): Promise<string> {
  const token = generateRandomToken(32)
  await createSession(env, token, SESSION_TTL_MS)
  return token
}

export function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

export async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  const token = getCookie(request, COOKIE_NAME)
  if (!token) return false
  return isSessionValid(env, token)
}

export async function logoutAdmin(request: Request, env: Env): Promise<void> {
  const token = getCookie(request, COOKIE_NAME)
  if (token) await deleteSession(env, token)
}

export { COOKIE_NAME }
