import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'

// Open without a session: the login page, the login endpoint, and the machine
// endpoint the scheduler calls (it authenticates itself with CRON_SECRET).
const OPEN = ['/login', '/api/login', '/api/cron/pull']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)

  if (OPEN.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    if (session && pathname === '/login') return NextResponse.redirect(new URL('/', req.url))
    return NextResponse.next()
  }
  if (session) return NextResponse.next()

  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const url = new URL('/login', req.url)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except Next internals and public static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|sw.js).*)'],
}
