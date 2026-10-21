import { NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')

const cookieOf = (req: Request, name: string) => {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}

/** For API routes. Returns null when allowed, or the response to send back (401 not signed in, 403 not permitted). */
export async function denyUnless(req: Request, perm: string): Promise<NextResponse | null> {
  const s = await verifySession(cookieOf(req, SESSION_COOKIE))
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const a = await users.access(s.username)
  if (!a) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!a.perms.includes(perm)) return NextResponse.json({ error: 'You do not have permission to do that.' }, { status: 403 })
  return null
}
