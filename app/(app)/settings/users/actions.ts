'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')

const BACK = '/settings/users'

export async function createAccount(f: FormData) {
  await act(BACK, async () => {
    await users.accounts.create({ username: f.get('username'), password: f.get('password'), roleChoice: f.get('access') })
    return 'Account created.'
  }, undefined, undefined)
}

// Role, new password and the on/off switch all come from one row form.
export async function saveAccount(f: FormData) {
  const username = String(f.get('username'))
  await act(BACK, async (s) => {
    const patch: Record<string, unknown> = {}
    // A disabled field is not submitted: your own administrator row cannot change its access.
    if (f.has('access')) patch.roleChoice = f.get('access') === 'none' ? '' : f.get('access')
    const pw = String(f.get('password') || '')
    if (pw) patch.password = pw
    const nn = String(f.get('newUsername') || '').trim()
    if (nn && nn !== username) patch.newUsername = nn
    const changed = await users.accounts.update(username, patch, s.username)
    return changed ? 'Account saved.' : 'Nothing changed.'
  })
}

export async function setAccountEnabled(f: FormData) {
  const username = String(f.get('username')), disabled = f.get('disabled') === '1'
  await act(BACK, async (s) => { await users.accounts.update(username, { disabled }, s.username); return disabled ? 'Account switched off. It can no longer sign in.' : 'Account switched on.' })
}

export async function deleteAccount(f: FormData) {
  const username = String(f.get('username'))
  await act(BACK, async (s) => { await users.accounts.remove(username, s.username); return 'Account deleted.' })
}
