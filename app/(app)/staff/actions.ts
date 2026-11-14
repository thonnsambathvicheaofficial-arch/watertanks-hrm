'use server'

import { act, requireSession } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('@/lib/users')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const photo = require('@/lib/staff-photo')

// An uploaded file's bytes, or null when none was chosen (an empty file input still posts an empty file).
async function readFile(f: FormData, field: string): Promise<Buffer | null> {
  const p = f.get(field)
  if (!p || typeof p === 'string' || !p.size) return null
  return Buffer.from(await p.arrayBuffer())
}
const readPhoto = (f: FormData) => readFile(f, 'photo')
const readIdCard = (f: FormData) => readFile(f, 'idCard')
// The original PDF the card was cut from, kept beside it (field "idCardOriginal"). Optional; checked before anything is saved.
const readOriginal = async (f: FormData) => {
  const o = await readFile(f, 'idCardOriginal')
  const why = o ? photo.originalProblem(o) : null
  if (why) throw new hr.UserError(why)
  return o
}
// Checked BEFORE anything is saved, so a bad picture rejects the whole form instead of half-saving it.
function checkPhoto(bytes: Buffer | null) {
  const why = bytes ? photo.problem(bytes) : null
  if (why) throw new hr.UserError(why)
}
const reason = (e: unknown) => (e instanceof hr.UserError ? (e as Error).message : 'the file store did not answer.')

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
  await act('/staff/new', async () => {
    const bytes = await readPhoto(f), card = await readIdCard(f), original = card ? await readOriginal(f) : null
    checkPhoto(bytes); checkPhoto(card)
    await hr.staff.save(pin, readStaff(f), { create: true })
    // The person now exists, so a file problem must not send the form back (a second save would say the PIN is taken).
    const missed: string[] = []
    if (bytes) { try { await hr.staff.setPhoto(pin, bytes) } catch (e) { missed.push(`the photo (${reason(e)})`) } }
    if (card) { try { await hr.staff.setIdCard(pin, card, original) } catch (e) { missed.push(`the ID card picture (${reason(e)})`) } }
    return missed.length ? `Staff member added, but ${missed.join(' and ')} was not saved. Add it again from their profile.` : 'Staff member added.'
  }, `/staff/${encodeURIComponent(pin)}`, f)
}

export async function updateStaff(f: FormData) {
  const pin = String(f.get('pin'))
  await act(`/staff/${encodeURIComponent(pin)}`, async () => {
    const bytes = await readPhoto(f), card = await readIdCard(f), original = card ? await readOriginal(f) : null
    checkPhoto(bytes); checkPhoto(card)
    await hr.staff.save(pin, readStaff(f))
    try {
      if (bytes) await hr.staff.setPhoto(pin, bytes)
      else if (f.get('removePhoto') === 'on') await hr.staff.removePhoto(pin)
    } catch (e) { throw new hr.UserError(`The record was saved, but the photo was not: ${reason(e)}`) }
    try {
      if (card) await hr.staff.setIdCard(pin, card, original)
      else if (f.get('removeIdCard') === 'on') await hr.staff.removeIdCard(pin)
    } catch (e) { throw new hr.UserError(`The record was saved, but the ID card picture was not: ${reason(e)}`) }
    return 'Staff record saved.'
  }, undefined, f)
}

// The "National ID card" section of a staff profile saves the card on its own, without waiting for the rest of the form
// (its buttons post to these actions instead of "Save changes").
export async function saveIdCard(f: FormData) {
  const pin = String(f.get('pin'))
  await act(`/staff/${encodeURIComponent(pin)}`, async () => {
    const card = await readIdCard(f)
    if (!card) throw new hr.UserError('Choose the ID card photo or PDF first.')
    checkPhoto(card)
    const original = await readOriginal(f)
    try { await hr.staff.setIdCard(pin, card, original) } catch (e) { throw new hr.UserError(`The ID card was not saved: ${reason(e)}`) }
    return 'ID card saved.'
  }, undefined, f)
}

export async function removeIdCardAction(f: FormData) {
  const pin = String(f.get('pin'))
  await act(`/staff/${encodeURIComponent(pin)}`, async () => {
    const r = await hr.staff.removeIdCard(pin)
    return r.removed ? 'ID card removed.' : 'There was no ID card on file.'
  })
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

// "Add staff from ID" asks this once the card has been read: does anyone already have this ID number? Only people who may
// add staff can ask (it reveals who is on record), and nothing is changed.
export async function findIdCardOwner(idNumber: string): Promise<{ pin: string; name: string }[]> {
  const session = await requireSession()
  const access = await users.access(session.username)
  if (!access || !access.perms.includes('staff.edit')) return []
  return hr.staff.findByIdCard(String(idNumber || '').slice(0, 40))
}
