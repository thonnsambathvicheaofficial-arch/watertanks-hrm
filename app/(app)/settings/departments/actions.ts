'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

const BACK = '/settings/departments'

export async function createDepartment(f: FormData) {
  await act(BACK, async () => { await hr.departments.create(f.get('name')); return 'Department added.' })
}
export async function renameDepartment(f: FormData) {
  await act(BACK, async () => { await hr.departments.rename(String(f.get('id')), f.get('name')); return 'Department renamed.' })
}
export async function deleteDepartment(f: FormData) {
  await act(BACK, async () => { await hr.departments.remove(String(f.get('id'))); return 'Department deleted. Its staff are now unassigned.' })
}
