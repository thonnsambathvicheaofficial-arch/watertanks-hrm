'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

export async function saveOverride(f: FormData) {
  const pin = String(f.get('pin')), date = String(f.get('date')), month = String(f.get('month') || date.slice(0, 7))
  const back = `/roster/day?pin=${encodeURIComponent(pin)}&date=${date}&month=${month}`
  await act(back, async (s) => {
    await lv.overrides.set({ pin, date, status: f.get('status'), note: f.get('note'), timeIn: f.get('timeIn'), timeOut: f.get('timeOut'), by: s.username, originalStatus: f.get('originalStatus') })
    return 'Correction saved.'
  }, `/roster?month=${month}`, f)
}

export async function removeOverride(f: FormData) {
  const pin = String(f.get('pin')), date = String(f.get('date')), month = String(f.get('month') || date.slice(0, 7))
  await act(`/roster/day?pin=${encodeURIComponent(pin)}&date=${date}&month=${month}`, async () => { await lv.overrides.remove(pin, date); return 'Correction removed. The day follows the scans again.' }, `/roster?month=${month}`)
}
