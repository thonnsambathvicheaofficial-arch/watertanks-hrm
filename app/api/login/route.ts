import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const auth = require('@/lib/auth')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require('@/lib/audit')

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}))
  const user = await auth.check(username, password)
  if (!user) {
    // The password is never logged, only who tried.
    await audit.record({ actor: null, action: 'login.failed', entity: 'user', key: String(username || '').slice(0, 60), summary: `Failed sign-in for "${String(username || '').slice(0, 60)}"` })
    return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
  }
  // The password was right. If the server cannot sign a session (SESSION_SECRET not set on this deployment), say so
  // plainly instead of a bare 500, so the person setting up a new environment can see what to fix.
  let token: string
  try { token = auth.sign(user.username, user.role) } catch (e) {
    console.error('[login]', (e as Error).message)
    return NextResponse.json({ error: 'Signing in is not set up on this server yet: SESSION_SECRET is missing. Add it under the Vercel project\'s Environment Variables and redeploy.' }, { status: 500 })
  }
  await audit.record({ actor: user.username, action: 'login.success', entity: 'user', key: user.username, summary: `${user.username} signed in` })
  const res = NextResponse.json({ ok: true, username: user.username })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: auth.MAXAGE, secure: process.env.NODE_ENV === 'production',
  })
  return res
}
