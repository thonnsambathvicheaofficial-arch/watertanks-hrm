// Edge-safe verification of the existing `rp_session` cookie (same format that
// lib/auth.js signs: base64("user|role|expiry|hmac")). Sessions issued by the
// legacy app stay valid in the new one, so nobody is logged out at cutover.
export const SESSION_COOKIE = 'rp_session'

export interface Session { username: string; role: string }

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')

function sameLength(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  const secret = process.env.SESSION_SECRET
  if (!token || !secret) return null
  try {
    const bytes = Uint8Array.from(atob(token), c => c.charCodeAt(0))
    const raw = new TextDecoder().decode(bytes)
    const i = raw.lastIndexOf('|')
    const payload = raw.slice(0, i), mac = raw.slice(i + 1)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expect = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
    if (!sameLength(mac, expect)) return null
    const [username, role, exp] = payload.split('|')
    if (Date.now() > Number(exp)) return null
    return { username, role }
  } catch { return null }
}
