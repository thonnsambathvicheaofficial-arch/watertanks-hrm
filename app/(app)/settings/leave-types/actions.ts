'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

const BACK = '/settings/leave-types'

function read(f: FormData) {
  return { code: f.get('code'), name: f.get('name'), isPaid: f.get('isPaid') === 'on', defaultDays: f.get('defaultDays'), isActive: f.get('isActive') === 'on' }
}

export async function addLeaveType(f: FormData) {
  await act(BACK, async () => { await lv.types.save(null, read(f)); return 'Leave type added.' }, undefined, f)
}
export async function updateLeaveType(f: FormData) {
  await act(BACK, async () => { await lv.types.save(String(f.get('id')), read(f)); return 'Leave type saved.' })
}
export async function deleteLeaveType(f: FormData) {
  await act(BACK, async () => { await lv.types.remove(String(f.get('id'))); return 'Leave type deleted.' })
}
