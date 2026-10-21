'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UserError, HHMM } = require('@/lib/hr-store')

export async function saveWorkHours(f: FormData) {
  await act('/settings/work-hours', async () => {
    const workStart = String(f.get('workStart') || '').trim(), workEnd = String(f.get('workEnd') || '').trim()
    const graceMinutes = Number(f.get('graceMinutes'))
    if (!HHMM.test(workStart) || !HHMM.test(workEnd)) throw new UserError('Times must look like 08:00.')
    if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) throw new UserError('Grace minutes must be a whole number from 0 to 120.')
    await store.settings.set({ workStart, workEnd, graceMinutes })
    return 'Default work hours saved.'
  }, undefined, f)
}
