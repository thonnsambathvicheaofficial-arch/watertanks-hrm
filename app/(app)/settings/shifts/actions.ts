'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

const BACK = '/settings/shifts'

function readShift(f: FormData) {
  return {
    name: f.get('name'), start: f.get('start'), end: f.get('end'),
    graceMinutes: f.get('graceMinutes'), offDays: f.getAll('offDays'),
  }
}

export async function createShift(f: FormData) {
  await act('/settings/shifts/new', async () => { await hr.shifts.create(readShift(f)); return 'Shift created.' }, BACK, f)
}

export async function updateShift(f: FormData) {
  const id = String(f.get('id'))
  await act(`${BACK}/${id}`, async () => { await hr.shifts.update(id, readShift(f)); return 'Shift saved. Staff on it were updated.' }, BACK, f)
}

export async function deleteShift(f: FormData) {
  const id = String(f.get('id'))
  await act(`${BACK}/${id}`, async () => { await hr.shifts.remove(id); return 'Shift deleted.' }, BACK)
}
