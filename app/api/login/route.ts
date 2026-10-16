import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const auth = require('@/lib/auth')

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}))
  const user = await auth.check(username, password)
  if (!user) return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
  const res = NextResponse.json({ ok: true, username: user.username })
  res.cookies.set(SESSION_COOKIE, auth.sign(user.username, user.role), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: auth.MAXAGE, secure: process.env.NODE_ENV === 'production',
  })
  return res
}
