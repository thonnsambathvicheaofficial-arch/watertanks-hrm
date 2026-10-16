'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

function readStaff(f: FormData) {
  return {
    name: f.get('name'), group: f.get('group'), departmentId: f.get('departmentId'), position: f.get('position'),
    phone: f.get('phone'), joiningDate: f.get('joiningDate'), resignedDate: f.get('resignedDate'),
    shiftId: f.get('shiftId'), timeIn: f.get('timeIn'), timeOut: f.get('timeOut'),
    offDays: f.getAll('offDays'), aliases: f.get('aliases'),
  }
}

export async function createStaff(f: FormData) {
  const pin = String(f.get('pin') || '').trim()
  await act('/staff/new', async () => { await hr.staff.save(pin, readStaff(f), { create: true }); return 'Staff member added.' }, `/staff/${encodeURIComponent(pin)}`, f)
}

export async function updateStaff(f: FormData) {
  const pin = String(f.get('pin'))
  await act(`/staff/${encodeURIComponent(pin)}`, async () => { await hr.staff.save(pin, readStaff(f)); return 'Staff record saved.' }, undefined, f)
}

export async function addAssignment(f: FormData) {
  const pin = String(f.get('pin'))
  await act(`/staff/${encodeURIComponent(pin)}`, async (s) => {
    await hr.assignments.create({ pin, shiftId: f.get('shiftId'), from: f.get('from'), to: f.get('to'), note: f.get('note'), by: s.username })
    return 'Rotation assignment added.'
  }, undefined, f)
}

export async function removeAssignment(f: FormData) {
  const pin = String(f.get('pin'))
  await act(`/staff/${encodeURIComponent(pin)}`, async () => { await hr.assignments.remove(String(f.get('id'))); return 'Assignment removed.' })
}
