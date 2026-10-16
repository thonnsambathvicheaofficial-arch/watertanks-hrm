'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')

const back = (f: FormData) => `/payroll/overtime?year=${f.get('year')}&month=${f.get('month')}${f.get('status') ? `&status=${f.get('status')}` : ''}`

export async function suggestOvertime(f: FormData) {
  await act(back(f), async (s) => {
    const n = await pr.overtime.suggest(Number(f.get('year')), Number(f.get('month')), s.username)
    return n ? `${n} overtime suggestion${n === 1 ? '' : 's'} added from the scans. Review and approve each one.` : 'No new suggestions. Either nothing was worked past shift end, or every day already has an entry.'
  })
}

// One action for the row buttons. The decision comes from the button's value.
export async function decideOvertime(f: FormData) {
  const decision = String(f.get('decision'))
  await act(back(f), async (s) => {
    const id = String(f.get('id'))
    if (decision === 'remove') { await pr.overtime.remove(id); return 'Entry removed.' }
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'pending'
    await pr.overtime.decide(id, { status, hours: f.get('hours'), by: s.username })
    return status === 'approved' ? 'Approved.' : status === 'rejected' ? 'Rejected.' : 'Set back to pending.'
  })
}

export async function decideAllOvertime(f: FormData) {
  const decision = String(f.get('decision'))
  await act(back(f), async (s) => {
    const n = await pr.overtime.decideAllPending(Number(f.get('year')), Number(f.get('month')), decision === 'approve' ? 'approved' : 'rejected', s.username)
    return n ? `${n} pending entr${n === 1 ? 'y' : 'ies'} ${decision === 'approve' ? 'approved' : 'rejected'}.` : 'Nothing was pending.'
  })
}

export async function addOvertime(f: FormData) {
  await act(back(f), async (s) => {
    await pr.overtime.add({ pin: f.get('pin'), date: f.get('date'), hours: f.get('hours'), note: f.get('note'), by: s.username })
    return 'Overtime added and approved.'
  }, undefined, f)
}
