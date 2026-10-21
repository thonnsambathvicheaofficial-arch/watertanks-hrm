'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isDate, monthOf } = require('@/lib/calendar')

// Every action lands back on the calendar at the day it was about, so the result is the first thing HR sees.
const backTo = (date: string) => (isDate(date) ? `/holidays?month=${monthOf(date)}&date=${date}` : '/holidays')

export async function addHoliday(f: FormData) {
  const date = String(f.get('date') || '')
  await act(backTo(date), async () => {
    const dates: string[] = await lv.holidays.addRange({ date, days: f.get('days'), name: f.get('name'), nameKh: f.get('nameKh') })
    return dates.length > 1 ? `Holiday added for ${dates.length} days, ${dates[0]} to ${dates[dates.length - 1]}.` : 'Holiday added.'
  }, undefined, f)
}

export async function saveHoliday(f: FormData) {
  const date = String(f.get('date') || '')
  await act(backTo(date), async () => { await lv.holidays.update({ date, name: f.get('name'), nameKh: f.get('nameKh') }); return 'Holiday saved.' }, undefined, f)
}

export async function removeHoliday(f: FormData) {
  const date = String(f.get('date') || '')
  await act(isDate(date) ? `/holidays?month=${monthOf(date)}` : '/holidays', async () => { await lv.holidays.remove(date); return 'Holiday removed.' })
}
