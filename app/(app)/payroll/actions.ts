'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')

const pad = (n: number) => String(n).padStart(2, '0')
const here = (f: FormData) => `/payroll/${f.get('year')}-${pad(Number(f.get('month')))}`

export async function generateRun(f: FormData) {
  await act(here(f), async (s) => {
    const r = await pr.runs.generate(Number(f.get('year')), Number(f.get('month')), s.username)
    const parts = [`Draft ready: ${r.count} slip${r.count === 1 ? '' : 's'}.`]
    if (r.incomplete) parts.push(`${r.incomplete} incomplete, see the notes on each.`)
    if (r.skipped.length) parts.push(`${r.skipped.length} left out (no salary set).`)
    return parts.join(' ')
  })
}

export async function finalizeRun(f: FormData) {
  await act(here(f), async (s) => { await pr.runs.finalize(Number(f.get('year')), Number(f.get('month')), s.username); return 'Payroll finalized. These figures are now locked.' }, undefined, undefined, 'payroll.finalize')
}

export async function discardRun(f: FormData) {
  await act('/payroll', async () => { await pr.runs.discard(Number(f.get('year')), Number(f.get('month'))); return 'Draft discarded.' })
}
