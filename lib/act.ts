import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { SESSION_COOKIE, verifySession, type Session } from '@/lib/session'
import { encodeEcho } from '@/lib/echo'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UserError } = require('@/lib/hr-store')

// Every server action starts here: the middleware already guards the route, this
// re-checks the session so an action can never run unauthenticated.
export async function requireSession() {
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value)
  if (!s) redirect('/login')
  return s
}

const withParam = (path: string, key: string, value: string) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`

/**
 * Run a mutation, then land back on `back` with either a "saved" or an "error"
 * flash. Only UserError messages (written to be read by a person) reach the
 * screen; anything unexpected is rethrown to the error boundary.
 */
export async function act(back: string, fn: (session: Session) => Promise<string | void>, okPath?: string, form?: FormData): Promise<never> {
  const session = await requireSession()
  let error = '', ok = ''
  try { ok = (await fn(session)) || '' } catch (e) {
    if (e instanceof UserError) error = (e as Error).message
    else throw e
  }
  revalidatePath('/', 'layout')
  if (error) redirect(form ? withParam(withParam(back, 'error', error), 'v', encodeEcho(form)) : withParam(back, 'error', error))
  redirect(withParam(okPath || back, 'saved', ok || '1'))
}
