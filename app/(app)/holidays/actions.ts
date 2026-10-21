'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

export async function addHoliday(f: FormData) {
  const date = String(f.get('date') || '')
  const back = `/holidays?year=${date.slice(0, 4) || new Date().getFullYear()}`
  await act(back, async () => { await lv.holidays.add({ date, name: f.get('name'), nameKh: f.get('nameKh') }); return 'Holiday added.' }, undefined, f)
}

export async function removeHoliday(f: FormData) {
  const date = String(f.get('date'))
  await act(`/holidays?year=${date.slice(0, 4)}`, async () => { await lv.holidays.remove(date); return 'Holiday removed.' })
}
