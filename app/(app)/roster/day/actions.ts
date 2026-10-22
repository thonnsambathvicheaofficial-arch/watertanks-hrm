'use server'

import { act } from '@/lib/act'
import { safeReturn } from '@/lib/return-to'

// Where the person was working: the filtered roster they opened the day from (or just the month).
const fields = (f: FormData) => {
  const pin = String(f.get('pin')), date = String(f.get('date')), month = String(f.get('month') || date.slice(0, 7)), ret = safeReturn(f.get('return'))
  return { pin, date, month, ret, here: `/roster/day?pin=${encodeURIComponent(pin)}&date=${date}&month=${month}${ret ? `&return=${encodeURIComponent(ret)}` : ''}`, list: ret || `/roster?month=${month}` }
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

export async function saveOverride(f: FormData) {
  const { pin, date, here, list } = fields(f)
  await act(here, async (s) => {
    await lv.overrides.set({ pin, date, status: f.get('status'), note: f.get('note'), timeIn: f.get('timeIn'), timeOut: f.get('timeOut'), by: s.username, originalStatus: f.get('originalStatus') })
    return 'Correction saved.'
  }, `${list}#c-${pin}-${date}`, f)
}

export async function removeOverride(f: FormData) {
  const { pin, date, here, list } = fields(f)
  await act(here, async () => { await lv.overrides.remove(pin, date); return 'Correction removed. The day follows the scans again.' }, `${list}#c-${pin}-${date}`)
}
