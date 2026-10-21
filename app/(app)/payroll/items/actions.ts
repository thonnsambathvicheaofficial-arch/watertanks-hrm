'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')

const back = (f: FormData) => `/payroll/items?year=${f.get('year')}&month=${f.get('month')}`

export async function addItem(f: FormData) {
  await act(back(f), async (s) => {
    await pr.entries.add({ pin: f.get('pin'), year: Number(f.get('year')), month: Number(f.get('month')), kind: f.get('kind'), label: f.get('label'), amount: f.get('amount'), remarks: f.get('remarks'), by: s.username })
    return 'Item added.'
  }, undefined, f)
}

export async function removeItem(f: FormData) {
  await act(back(f), async () => { await pr.entries.remove(String(f.get('id'))); return 'Item removed.' })
}
