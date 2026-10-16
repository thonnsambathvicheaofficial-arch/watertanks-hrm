import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const P = require('@/lib/permissions')

export interface Access { username: string; isAdmin: boolean; roleName: string; perms: string[] }

/** Who is signed in and what they may do, from the database. Null = not signed in (or the account is gone or switched off). */
export async function getAccess(): Promise<Access | null> {
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value)
  if (!s) return null
  return users.access(s.username)
}

export const can = (a: Access | null, perm: string) => !!a && a.perms.includes(perm)

/** For pages: the signed-in person, or a redirect to sign in. */
export async function requireAccess(): Promise<Access> {
  const a = await getAccess()
  if (!a) redirect('/login')
  return a
}

/** The permission the page being rendered needs, from the route table. Unknown pages need an administrator. */
export function currentPagePermission(): string {
  return P.viewPermFor(headers().get('x-pathname') || '/')
}
