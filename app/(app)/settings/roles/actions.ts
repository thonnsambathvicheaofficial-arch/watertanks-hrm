'use server'

import { redirect } from 'next/navigation'
import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')

const BACK = '/settings/roles'

export async function createRole(f: FormData) {
  await act(BACK, async () => { await users.roles.create({ name: f.get('name'), description: f.get('description') }, []); return 'Role created. Open it to choose what it can do.' }, undefined, f)
}

export async function createFromTemplate(f: FormData) {
  await act(BACK, async () => { await users.roles.fromTemplate(String(f.get('template'))); return `The "${f.get('template')}" role was created. Open it to check or change what it can do.` })
}

export async function saveRole(f: FormData) {
  const id = String(f.get('id'))
  await act(`${BACK}/${id}`, async () => { await users.roles.save(id, { name: f.get('name'), description: f.get('description') }, f.getAll('perm').map(String)); return 'Role saved.' }, undefined, f)
}

export async function deleteRole(f: FormData) {
  const id = String(f.get('id'))
  await act(`${BACK}/${id}`, async () => { await users.roles.remove(id); return 'Role deleted.' }, BACK)
}

// Not an action on data: sends the user to a role's page.
export async function openRole(f: FormData) { redirect(`${BACK}/${f.get('id')}`) }
