'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

const BACK = '/rotation'

export async function assignRotation(f: FormData) {
  const pins = f.getAll('pins').map(String)
  await act(BACK, async (s) => {
    if (!pins.length) throw new hr.UserError('Tick at least one staff member.')
    const r = await hr.assignments.createMany({ pins, shiftId: f.get('shiftId'), from: f.get('from'), to: f.get('to'), note: f.get('note'), by: s.username })
    if (!r.created.length) throw new hr.UserError(`Nobody was assigned. ${r.conflicts.map((c: { pin: string; reason: string }) => `PIN ${c.pin}: ${c.reason}`).join(' ')}`)
    const skipped = r.conflicts.length
      ? ` Skipped ${r.conflicts.length}: ${r.conflicts.map((c: { pin: string; reason: string }) => `PIN ${c.pin} (${c.reason})`).join('; ')}`
      : ''
    return `Assigned ${r.created.length} staff.${skipped}`
  }, undefined, f)
}

export async function removeRotation(f: FormData) {
  await act(BACK, async () => { await hr.assignments.remove(String(f.get('id'))); return 'Assignment removed.' })
}
