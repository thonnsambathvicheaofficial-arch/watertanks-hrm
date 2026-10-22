import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { SESSION_COOKIE, verifySession, type Session } from '@/lib/session'
import { encodeEcho } from '@/lib/echo'
import { keepFilters as keepFiltersFrom } from '@/lib/return-to'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UserError } = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require('@/lib/audit')
// Installs the audit-log entries on every store function that changes data.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('@/lib/audit-hooks')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const P = require('@/lib/permissions')

// The signed-in person, or a redirect to sign in.
export async function requireSession() {
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value)
  if (!s) redirect('/login')
  return s
}

const withParam = (path: string, key: string, value: string) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`

// Keeps the page's filters on a save that lands back on the same page (see lib/return-to.ts).
const keepFilters = (target: string) => keepFiltersFrom(target, headers().get('referer'), headers().get('host'))

// "/settings/payroll" -> "payroll", "/payroll/2026-08" -> "payroll": the area an action belongs to, for the audit log.
const areaOf = (path: string) => path.split('?')[0].split('/').filter(Boolean).filter(s => s !== 'settings')[0] || 'home'

/**
 * Run a mutation, then land back on `back` with either a "saved" or an "error" flash.
 *
 * Every action goes through here, so this is where it is checked and logged:
 *  - the person must be signed in, their account must still exist, and their role must grant
 *    the permission (`perm`, or the default for the page the form lives on; unknown pages
 *    need an administrator);
 *  - a successful action is written to the audit log (unless the code already recorded a
 *    more detailed entry itself).
 * Only UserError messages (written to be read by a person) reach the screen; anything
 * unexpected is rethrown to the error boundary.
 */
export async function act(back: string, fn: (session: Session) => Promise<string | void>, okPath?: string, form?: FormData, perm?: string): Promise<never> {
  const session = await requireSession()
  const access = await users.access(session.username)
  if (!access) redirect('/login')
  const need = perm ?? P.editPermFor(back)
  if (!access.perms.includes(need)) {
    await audit.record({ actor: session.username, action: 'permission.denied', entity: areaOf(back), summary: `Tried to change something on ${back.split('?')[0]} without permission (${need})` })
    redirect(withParam(keepFilters(back), 'error', 'You do not have permission to do that.'))
  }

  const ctx = { actor: session.username, recorded: false }
  let error = '', ok = ''
  try { ok = (await audit.runWith(ctx, () => fn(session))) || '' } catch (e) {
    if (e instanceof UserError) error = (e as Error).message
    else throw e
  }
  if (!error && !ctx.recorded) {
    await audit.record({ actor: session.username, action: 'action', entity: areaOf(back), summary: ok || 'Saved', details: { page: back.split('?')[0] } })
  }
  revalidatePath('/', 'layout')
  const stay = keepFilters(back)
  if (error) redirect(form ? withParam(withParam(stay, 'error', error), 'v', encodeEcho(form)) : withParam(stay, 'error', error))
  redirect(withParam(okPath ? keepFilters(okPath) : stay, 'saved', ok || '1'))
}
