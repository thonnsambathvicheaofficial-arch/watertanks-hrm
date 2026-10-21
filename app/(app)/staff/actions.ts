'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

// Fields the form does not show (before migration 005) are left out, so saving never touches them.
const EXT = ['staffCode', 'nameKh', 'gender', 'dateOfBirth', 'maritalStatus', 'idCardNo', 'nssfNo', 'address', 'personalEmail', 'emergencyContact', 'emergencyPhone', 'employmentType', 'probationEnd', 'lineManager', 'resignReason']

function readStaff(f: FormData) {
  const ext = Object.fromEntries(EXT.filter(k => f.has(k)).map(k => [k, f.get(k)]))
  return {
    ...ext,
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

export async function renamePin(f: FormData) {
  const pin = String(f.get('pin')), newPin = String(f.get('newPin') || '').trim()
  await act(`/staff/${encodeURIComponent(pin)}`, async () => {
    const r = await hr.staff.rename(pin, newPin, { keepOld: f.get('keepOld') === 'on' })
    return `PIN changed from ${pin} to ${newPin}. ${r.scans} scan${r.scans === 1 ? '' : 's'} moved with it.`
  }, `/staff/${encodeURIComponent(newPin)}`, f)
}
